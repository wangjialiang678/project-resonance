# ASR 迁移设计文档：StepFun → DashScope via Workers

> 日期：2026-03-17 | 状态：已实现

## 背景

当前 ASR（语音识别）仍直连 StepFun API，存在两个问题：
1. 账户余额不足时用户看到"请前往 platform.stepfun.com 充值"——应该用阿里云 DashScope
2. `VITE_STEPFUN_API_KEY` 暴露在前端构建产物中，有安全风险

TTS 和 Voice Clone 已通过 Cloudflare Workers 代理调用 DashScope，ASR 应跟进。

## 方案概述

```
前端录制 webm → fetch(${API_BASE}/dashscope-asr, FormData{file})
  → Cloudflare Workers
  → DashScope /compatible-mode/v1/audio/transcriptions
  → { text: string }
```

- 使用 DashScope OpenAI 兼容同步接口，与 StepFun 格式几乎完全一致
- 模型：`paraformer-realtime-v2`
- `DASHSCOPE_API_KEY` 已在 Workers env 中，无需新增 secret

## 文件改动清单

### 1. 新建 `workers/api/src/dashscope-asr.ts`（~50 行）

ASR 代理 handler，参考 `cosyvoice-clone.ts` 的 FormData 处理模式。

```typescript
import type { Env } from "./env";
import { corsResponse } from "./cors";

const DASHSCOPE_ASR_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions";
const ASR_MODEL = "paraformer-realtime-v2";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function handleASR(
  request: Request,
  env: Env,
  origin?: string | null
): Promise<Response> {
  if (request.method !== "POST") {
    return corsResponse(
      JSON.stringify({ error: "Method not allowed" }),
      405, undefined, origin
    );
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return corsResponse(
        JSON.stringify({ error: "Expected multipart/form-data" }),
        400, undefined, origin
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get("file") as File | null;
    if (!audioFile) {
      return corsResponse(
        JSON.stringify({ error: "Missing 'file' field" }),
        400, undefined, origin
      );
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      return corsResponse(
        JSON.stringify({ error: "文件过大（最大 20MB）" }),
        400, undefined, origin
      );
    }

    // 构建转发到 DashScope 的 FormData
    const upstream = new FormData();
    upstream.append("file", audioFile, audioFile.name || "recording.webm");
    upstream.append("model", ASR_MODEL);

    const response = await fetch(DASHSCOPE_ASR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
      },
      body: upstream,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[asr] DashScope error:", response.status, errText);
      let errData: Record<string, unknown> = {};
      try { errData = JSON.parse(errText); } catch { errData = { error: errText }; }
      return corsResponse(
        JSON.stringify({ error: "语音识别失败", detail: errData }),
        response.status, undefined, origin
      );
    }

    // 透传 DashScope 响应 { text: string }
    const result = await response.text();
    return corsResponse(result, 200, undefined, origin);
  } catch (err) {
    console.error("[asr] Error:", err);
    return corsResponse(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      500, undefined, origin
    );
  }
}
```

### 2. 修改 `workers/api/src/index.ts`（+2 行）

```diff
+import { handleASR } from "./dashscope-asr";

 switch (url.pathname) {
   case "/cosyvoice-tts":
     return handleTTS(request, env, origin);
   case "/cosyvoice-voice-clone":
     return handleClone(request, env, origin);
+  case "/dashscope-asr":
+    return handleASR(request, env, origin);
   default:
     return corsResponse(JSON.stringify({ error: "Not found" }), 404, undefined, origin);
 }
```

### 3. 修改 `src/hooks/useStepfunASR.ts`（~15 行改动）

核心改动：去掉前端 API key，改为通过 Workers 代理调用。

**改动前**：
```typescript
const STEPFUN_ASR_URL = 'https://api.stepfun.com/v1/audio/transcriptions';
const directKey = import.meta.env.VITE_STEPFUN_API_KEY as string | undefined;
// ...
if (directKey) {
  // 直连 StepFun
  formData.append('model', 'step-asr');
  const response = await fetch(STEPFUN_ASR_URL, {
    headers: { Authorization: `Bearer ${directKey}` },
    body: formData,
  });
}
```

**改动后**：
```typescript
const API_BASE = import.meta.env.VITE_API_URL || '';
// ...
const formData = new FormData();
formData.append('file', audioBlob, 'recording.webm');
// 不传 model（Workers 端负责设置）
// 不传 Authorization（Workers 端负责鉴权）

const response = await fetch(`${API_BASE}/dashscope-asr`, {
  method: 'POST',
  body: formData,
});

if (!response.ok) {
  const errData = await response.json().catch(() => ({}));
  throw new Error(formatStepfunError(response.status, errData, '语音识别'));
}

const data = await response.json();
const text = typeof data.text === 'string' ? data.text.trim() : '';
```

- 删除 `VITE_STEPFUN_API_KEY` 相关的直连分支
- 删除 `if (!directKey) throw` 的逻辑
- endpoint 改为 `${API_BASE}/dashscope-asr`
- `formatStepfunError` 可继续复用（错误码格式兼容）

### 4. 修改 `src/utils/stepfunErrors.ts`（可选，改提示文案）

将 402 的提示从：
```
'账户余额不足，请前往 platform.stepfun.com 充值'
```
改为：
```
'API 服务余额不足，请联系管理员'
```
（用户不需要知道后端用的哪个 provider）

### 5. 清理环境变量

- `.env` 中删除或注释掉 `VITE_STEPFUN_API_KEY`
- `.env.local` 中的 `VITE_STEPFUN_API_KEY` 也注释掉

## 不需要改动的文件

- `workers/api/src/env.ts` — `DASHSCOPE_API_KEY` 已在接口中
- `src/pages/UsagePage.tsx` — 调用的是 `useStepfunASR` 的 `transcribe()` 返回值，接口不变
- `workers/api/wrangler.toml` — 无需新配置

## 测试验证方案

### P0（构建健康）
- [x] `bun run build` 退出码 = 0
- [ ] Workers `npx wrangler deploy` 成功

### P1（功能验证）
- [ ] curl 测试 Workers ASR 端点：发送真实音频文件，返回 `{ text: "..." }`
- [ ] curl 测试无 file 字段：返回 400
- [ ] 前端使用页录音 → 识别 → 显示文字结果（不再出现 StepFun 错误）
- [ ] 确认构建产物中不包含 StepFun API key
