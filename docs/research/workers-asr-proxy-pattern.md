# 调研报告: Cloudflare Workers 代理语音识别 API 请求

**日期**: 2026-03-17
**任务**: 调研如何在 Cloudflare Workers 中代理语音识别 API 请求，处理 multipart/form-data 音频上传并转发到第三方 ASR API（StepFun / 火山引擎）

---

## 调研摘要

Cloudflare Workers 可以可靠地代理 multipart/form-data 音频上传到第三方 ASR API。关键约束是：128 MB 内存上限对短录音（<10MB）完全够用；免费版 CPU 时间只有 10ms 但 I/O 等待不计入，代理场景无需切换到付费版。最简实现是直接透传 `request.body`（不解析 FormData），若需要添加 API Key 头则在 Worker 侧新建 FormData。

---

## 现有代码分析

### 相关文件

- `workers/api/src/cosyvoice-clone.ts` — 已有 multipart/form-data 解析模式（`await request.formData()` + `formData.get("audio") as File`），可直接参考
- `workers/api/src/cosyvoice-tts.ts` — 展示了如何通过 `connect()` 绕过 Workers fetch() 的 WebSocket 限制，ASR 不涉及 WS 无需参考
- `workers/api/src/index.ts` — 路由入口，新增 `/asr` 路由只需加一个 `case`
- `workers/api/src/env.ts` — 环境变量类型，需要添加 `STEPFUN_API_KEY` 和/或 `VOLCENGINE_ASR_*` 字段
- `workers/api/wrangler.toml` — 当前 `compatibility_date = "2024-09-23"`，已足够新，无需额外兼容性 flag
- `src/hooks/useStepfunASR.ts` — 前端当前直接调用 StepFun API（使用用户配置的 key），代理后需要修改 fetch 目标 URL
- `src/services/volcengineASR.ts` — 火山引擎 WebSocket 流式 ASR，不走 HTTP multipart，不在本次代理范围内

### 现有模式（cosyvoice-clone.ts 可复用）

1. `await request.formData()` 解析传入的 multipart
2. `formData.get("audio") as File` 获取 File 对象
3. `await audioFile.arrayBuffer()` 读取二进制内容
4. 文件大小校验（MAX_FILE_SIZE = 10MB）
5. 错误统一通过 `corsResponse()` 返回

---

## Workers 关键限制

### 请求体大小限制

| Cloudflare 账号层级 | 请求体上限 |
|---|---|
| Free / Pro | **100 MB** |
| Business | 200 MB |
| Enterprise | 500 MB（默认，可申请更高） |

> 注意：这是 **账号** 层级限制，非 Workers 套餐限制。超出返回 `413 Request entity too large`。
> 对于语音识别场景，单次录音通常 1-5 MB（webm/opus），100 MB 完全够用。

### 内存限制

- **128 MB**，免费版和付费版相同
- 包含 JS heap + WebAssembly 分配
- **关键风险**：`await request.formData()` 会将整个文件加载到内存。对 10 MB 以内的音频文件没有问题（克隆 handler 已验证此模式可行）。如果未来需要支持更大文件（>50 MB），需改为流式透传。

### CPU 时间限制

| 套餐 | HTTP 请求 CPU 时间上限 |
|---|---|
| **Free** | **10 ms** |
| **Paid** | 5 分钟（默认 30 秒） |

> **关键说明**：CPU 时间不等于总响应时间。**I/O 等待（网络请求等待）不计入 CPU 时间**。代理模式下 Worker 主要在等待上游 ASR API 响应，实际 CPU 占用极低（<1ms 解析 FormData + 转发），**免费版 10ms CPU 上限完全够用**。

### subrequest 上限

- Free: 50 次/请求
- Paid: 10,000 次/请求
- ASR 代理只需 1 次 subrequest，无影响。

---

## StepFun ASR API 规格

**端点**: `POST https://api.stepfun.com/v1/audio/transcriptions`

**鉴权**: `Authorization: Bearer {API_KEY}` 请求头

**multipart/form-data 字段**:
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | File | 是 | 音频文件 |
| `model` | string | 是 | 固定值 `"step-asr"` |
| `response_format` | string | 是 | `json` / `text` / `srt` / `vtt` |
| `hotwords` | string | 否 | JSON 字符串列表，如 `["词1","词2"]` |

**支持格式**: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm, aac, opus

**文件大小上限**: 100 MB

**响应示例** (json 格式):
```json
{ "text": "识别出的文字内容" }
```

---

## 技术方案

### 方案 A: 直接透传 request.body（最轻量）

将客户端的整个 multipart body 原封不动转发给上游，Worker 只注入 Authorization 头。

**实现思路**:
```typescript
// Worker 收到 multipart/form-data 请求
// 直接用 request.body 作为新请求的 body，注入 API Key
const upstream = await fetch("https://api.stepfun.com/v1/audio/transcriptions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${env.STEPFUN_API_KEY}`,
    "Content-Type": request.headers.get("content-type")!, // 保留 boundary
  },
  body: request.body, // 直接透传 ReadableStream，不缓冲
});
```

**优点**:
- 零内存分配，完全流式，不受 128MB 限制
- 最简实现，约 10 行代码
- CPU 占用趋近于零

**缺点**:
- 无法在转发前校验文件（大小、类型）
- 无法修改 FormData 字段（如果上游需要的字段名和客户端不同）
- Cloudflare 会在 Worker 执行前缓冲整个请求体（防 slowloris 攻击），所以实际上并非真正流式，但 Worker 代码层面不需要分配内存

**实现复杂度**: 低

---

### 方案 B: 解析 FormData 后重建（参考 cosyvoice-clone.ts 模式）

Worker 解析 FormData，提取文件，做验证，然后重建 FormData 转发给上游。

**实现思路**:
```typescript
const formData = await request.formData();
const audioFile = formData.get("audio") as File | null;  // 客户端字段名

if (!audioFile) {
  return corsResponse(JSON.stringify({ error: "Missing audio" }), 400, undefined, origin);
}

// 大小校验
if (audioFile.size > 10 * 1024 * 1024) {
  return corsResponse(JSON.stringify({ error: "文件过大（最大 10MB）" }), 400, undefined, origin);
}

// 重建 FormData（适配上游 API 字段名）
const upstreamForm = new FormData();
upstreamForm.append("file", audioFile, audioFile.name || "recording.webm");
upstreamForm.append("model", "step-asr");
upstreamForm.append("response_format", "json");

const upstream = await fetch("https://api.stepfun.com/v1/audio/transcriptions", {
  method: "POST",
  headers: { "Authorization": `Bearer ${env.STEPFUN_API_KEY}` },
  // 不设 Content-Type，让 fetch 自动生成带 boundary 的 multipart header
  body: upstreamForm,
});
```

**优点**:
- 与现有 cosyvoice-clone.ts 模式完全一致，维护成本低
- 可以做文件大小/类型校验
- 可以将客户端字段名（如 `audio`）映射到上游字段名（如 `file`）
- 可以添加额外 FormData 字段（model、response_format）

**缺点**:
- 整个文件加载到内存（对 <10MB 音频无影响）
- 略多代码

**实现复杂度**: 低

---

### 方案 C: 支持多 ASR Provider 的路由代理

在方案 B 基础上，根据请求参数选择转发到 StepFun 或其他 ASR 服务。

**实现思路**:
```typescript
const provider = formData.get("provider") as string || "stepfun";

const upstreamConfigs = {
  stepfun: {
    url: "https://api.stepfun.com/v1/audio/transcriptions",
    authHeader: `Bearer ${env.STEPFUN_API_KEY}`,
    buildForm: (file: File) => {
      const f = new FormData();
      f.append("file", file, file.name);
      f.append("model", "step-asr");
      f.append("response_format", "json");
      return f;
    },
    parseResponse: (data: { text?: string }) => ({ text: data.text || "" }),
  },
  // 未来可扩展其他 REST-based ASR
};
```

**优点**:
- 一个端点支持多 provider 切换
- 前端只需改请求参数，不需要改 API URL

**缺点**:
- 火山引擎 ASR 是 WebSocket 二进制协议，无法用此方式代理（需要单独的 WS 代理端点）
- 对当前需求有过度设计之嫌

**实现复杂度**: 中

---

## 推荐方案

**推荐**: 方案 B（解析 FormData 后重建）

**理由**:
1. 与现有 `cosyvoice-clone.ts` 的实现模式完全一致，代码库风格统一
2. 能做文件大小校验（防止意外的大文件打爆内存）
3. 客户端字段名可以用 `audio`（与 clone handler 保持一致），Worker 内部映射到上游的 `file`
4. 音频录音体积通常 500KB-5MB，远低于 128MB 内存上限，不存在内存风险
5. 实现简单，约 40-50 行代码

---

## 实施建议

### 关键步骤

1. **更新 `env.ts`**: 添加 `STEPFUN_API_KEY: string`

2. **新建 `workers/api/src/stepfun-asr.ts`**: 实现 `handleASR()` handler
   - `await request.formData()` 解析
   - 文件大小校验（建议 10MB 上限）
   - 重建 FormData 转发到 StepFun
   - 统一错误格式，与其他 handler 一致

3. **更新 `index.ts`**: 添加路由 `case "/asr": return handleASR(request, env, origin);`

4. **更新 `wrangler.toml`**: 添加 `STEPFUN_API_KEY` 到 secrets 注释说明

5. **更新前端 `useStepfunASR.ts`**:
   - 添加代理模式分支（当 `VITE_STEPFUN_API_KEY` 不存在时走 `VITE_API_URL/asr`）
   - 将 FormData 字段 `file` → `audio`（与 clone 保持一致），或保持 `file` 也可

6. **部署时注入 secret**: `npx wrangler@4 deploy --var STEPFUN_API_KEY:$STEPFUN_API_KEY ...`

### 关键代码骨架

```typescript
// workers/api/src/stepfun-asr.ts
import type { Env } from "./env";
import { corsResponse } from "./cors";

const STEPFUN_ASR_URL = "https://api.stepfun.com/v1/audio/transcriptions";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function handleASR(
  request: Request,
  env: Env,
  origin?: string | null,
): Promise<Response> {
  if (request.method !== "POST") {
    return corsResponse(JSON.stringify({ error: "Method not allowed" }), 405, undefined, origin);
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return corsResponse(
        JSON.stringify({ error: "Expected multipart/form-data" }),
        400, undefined, origin,
      );
    }

    const formData = await request.formData();
    // 前端发送字段名与 clone handler 保持一致用 "audio"，也可用 "file"
    const audioFile = (formData.get("audio") ?? formData.get("file")) as File | null;
    if (!audioFile) {
      return corsResponse(JSON.stringify({ error: "Missing audio field" }), 400, undefined, origin);
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      return corsResponse(
        JSON.stringify({ error: "文件过大（最大 10MB）" }),
        400, undefined, origin,
      );
    }

    // 重建 FormData，映射字段名到 StepFun API 规格
    const upstreamForm = new FormData();
    upstreamForm.append("file", audioFile, audioFile.name || "recording.webm");
    upstreamForm.append("model", "step-asr");
    upstreamForm.append("response_format", "json");

    // 可选：透传 hotwords 字段
    const hotwords = formData.get("hotwords");
    if (hotwords) upstreamForm.append("hotwords", hotwords as string);

    console.log("[asr] Forwarding to StepFun, size:", audioFile.size, "type:", audioFile.type);

    const upstream = await fetch(STEPFUN_ASR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STEPFUN_API_KEY}`,
        // 不手动设 Content-Type，让 fetch 自动生成含 boundary 的 multipart header
      },
      body: upstreamForm,
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({})) as Record<string, unknown>;
      console.error("[asr] StepFun error:", upstream.status, errData);
      return corsResponse(
        JSON.stringify({ error: "ASR 服务错误", detail: errData }),
        upstream.status, undefined, origin,
      );
    }

    const result = await upstream.json() as { text?: string };
    console.log("[asr] SUCCESS, text length:", result.text?.length ?? 0);
    return corsResponse(JSON.stringify({ text: result.text || "" }), 200, undefined, origin);
  } catch (err) {
    console.error("[asr] Error:", err);
    return corsResponse(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      500, undefined, origin,
    );
  }
}
```

### 风险点

- **内存峰值** (低风险): `formData()` 将文件载入内存，10MB 文件消耗约 20-30MB 内存（JS 开销），128MB 上限内安全。缓解措施：保持 10MB 文件大小校验。
- **Content-Type 自动生成** (低风险): 重建 FormData 时不要手动设置 `Content-Type` 头，必须让 fetch 自动生成带 `boundary` 的值，否则上游无法解析。
- **CPU 时间 Free 套餐** (无风险): 虽然 Free 套餐只有 10ms CPU 时间，但网络 I/O 不计入 CPU，代理模式的 CPU 用量极少（解析 FormData <1ms），完全不会触发 CPU 超时。
- **火山引擎 ASR 不可代理** (已知限制): 火山引擎使用 WebSocket 二进制协议，不走 HTTP multipart，本方案只适用于 StepFun HTTP REST API。火山引擎 ASR 目前仍需前端直连（需用户自行配置 key）。

### 依赖项

- `env.ts` 中新增 `STEPFUN_API_KEY` 字段（wrangler secret）
- 无新增 npm 包

---

## 参考资料

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [StepFun 音频转写 API](https://platform.stepfun.com/docs/api-reference/audio/transcriptions)
- [Handling File Uploads with Cloudflare Workers](https://walshy.dev/blog/21_09_10-handling-file-uploads-with-cloudflare-workers)
- [CF Community: Cannot seem to send multipart/form-data](https://community.cloudflare.com/t/cannot-seem-to-send-multipart-form-data/163491)
- [CF Community: What are the limits when using workers for file uploads](https://community.cloudflare.com/t/what-are-the-limits-when-using-workers-for-file-uploads/237961)
