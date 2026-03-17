# ASR 迁移分析：StepFun → DashScope

**日期**: 2026-03-17
**任务**: 分析现有 StepFun ASR 调用链路，为迁移到 DashScope 做准备

---

## 现有 StepFun ASR 调用链路

### 前端调用路径

```
UsagePage.tsx
  └── handleStop()
        └── transcribe(webmBlob)          ← useStepfunASR.ts
              └── fetch('https://api.stepfun.com/v1/audio/transcriptions')
                    Headers: { Authorization: `Bearer ${VITE_STEPFUN_API_KEY}` }
                    Body: FormData { file: audioBlob (recording.webm), model: 'step-asr' }
                    Response: { text: string }
```

### 关键特征

| 项目 | 当前 StepFun 实现 |
|------|-----------------|
| **调用方式** | 前端直连 StepFun API（无 Workers 代理） |
| **API Key 来源** | `import.meta.env.VITE_STEPFUN_API_KEY`（构建时注入，暴露在前端） |
| **端点** | `https://api.stepfun.com/v1/audio/transcriptions` |
| **请求格式** | `multipart/form-data`，字段 `file`（.webm）和 `model`（step-asr） |
| **响应格式** | `{ text: string }` |
| **错误处理** | `formatStepfunError(status, errData, context)` from `stepfunErrors.ts` |
| **无 Workers 代理** | 没有走 `/cosyvoice-tts` 那种 Workers 中转路径 |

---

## 目标模式：DashScope via Workers（参考 useCosyVoiceTTS.ts）

TTS/Voice Clone 已经成熟地走了 Workers 代理模式：

```
useCosyVoiceTTS.ts
  └── fetch(`${API_BASE}/cosyvoice-tts`)      ← 指向 Cloudflare Workers
        Body: JSON { text, voice }
        Workers 内部:
          → fetch DashScope WebSocket / REST API
          → 用 env.DASHSCOPE_API_KEY（服务端 secret）
```

ASR 迁移后应遵循相同模式：

```
useStepfunASR.ts (重命名为 useDashscopeASR.ts 或保持名字)
  └── fetch(`${API_BASE}/dashscope-asr`)      ← 新 Workers 端点
        Body: FormData { file: audioBlob }
        Workers 内部:
          → fetch DashScope ASR REST API
          → 用 env.DASHSCOPE_API_KEY（服务端 secret，已有）
```

---

## DashScope ASR API 规格

DashScope 提供 OpenAI 兼容的音频转录接口（与 StepFun 格式高度相似）：

| 项目 | DashScope |
|------|-----------|
| **端点** | `https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions` |
| **方法** | `POST` |
| **Auth Header** | `Authorization: Bearer ${DASHSCOPE_API_KEY}` |
| **请求格式** | `multipart/form-data` |
| **字段** | `file`（音频文件）、`model`（如 `paraformer-realtime-v2`） |
| **响应** | `{ text: string }` |
| **支持格式** | wav, mp3, ogg, webm, flac, aac 等 |

> 注：DashScope 同时有异步文件转录 API（`/api/v1/services/audio/asr/transcription`）和 OpenAI 兼容同步接口。对于实时录音场景，推荐用兼容模式同步接口，与 StepFun 的接口格式几乎一致，迁移成本最低。

---

## 迁移对照表

### 1. 前端 Hook 改动（`useStepfunASR.ts`）

| 位置 | 当前 | 迁移后 |
|------|------|--------|
| API Key 来源 | `import.meta.env.VITE_STEPFUN_API_KEY` | 不需要前端 key（由 Workers 持有） |
| 端点 | `https://api.stepfun.com/v1/audio/transcriptions` | `${API_BASE}/dashscope-asr` |
| 请求 headers | `Authorization: Bearer ${directKey}` | 无（Workers 负责鉴权） |
| `model` 字段 | `step-asr` | `paraformer-realtime-v2`（Workers 内填，前端不传） |
| 错误处理 | `formatStepfunError()` | 可复用，或新建 `formatDashscopeError()` |
| 直连模式判断逻辑 | `if (directKey)` ... `else throw` | 删除直连分支，统一走 Workers |

**改动量**：约 15-20 行，逻辑不变，主要是换端点和去掉直连分支。

### 2. Workers 新增端点（`workers/api/src/`）

需要新增：

| 文件 | 内容 |
|------|------|
| `workers/api/src/dashscope-asr.ts` | 新建 handler，接收 multipart，转发到 DashScope ASR |
| `workers/api/src/index.ts` | 注册路由 `case '/dashscope-asr': return handleASR(request, env, origin)` |
| `workers/api/src/env.ts` | `DASHSCOPE_API_KEY` 已存在，**无需改动** |

**`dashscope-asr.ts` 核心逻辑**：
```typescript
// 接收前端的 multipart FormData
const formData = await request.formData();
const audioFile = formData.get('file');

// 转发到 DashScope OpenAI 兼容接口
const upstream = new FormData();
upstream.append('file', audioFile, 'recording.webm');
upstream.append('model', 'paraformer-realtime-v2');

const response = await fetch(
  'https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions',
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}` },
    body: upstream,
  }
);

// 直接透传响应 { text: string }
```

**改动量**：新增约 40-50 行（参考 `cosyvoice-clone.ts` 的写法）。

### 3. 错误处理改动

| 项目 | 说明 |
|------|------|
| `stepfunErrors.ts` 是否复用 | 可以复用，DashScope 错误格式与 StepFun 基本兼容（都有 `error.message`） |
| 402 充值提示 | 改为 `'账户余额不足，请前往 dashscope.aliyun.com 充值'` |
| 401 提示 | 可复用，改为通用描述 |
| 文件重命名 | 建议新建 `apiErrors.ts` 统一处理，或直接修改 `stepfunErrors.ts` 中的 URL 引用 |

---

## 环境变量变化

| 变量 | 当前 | 迁移后 |
|------|------|--------|
| `VITE_STEPFUN_API_KEY` | 前端构建时注入（暴露） | **可删除**（迁移后不再需要前端 key） |
| `DASHSCOPE_API_KEY` | Workers secret（已有） | 继续使用，无需变更 |

---

## 迁移步骤（推荐顺序）

1. **新建 `workers/api/src/dashscope-asr.ts`**，实现 ASR 代理 handler
2. **更新 `workers/api/src/index.ts`**，注册 `/dashscope-asr` 路由
3. **修改 `useStepfunASR.ts`**，将端点改为 `${API_BASE}/dashscope-asr`，删除直连分支
4. **更新 `.env` 和 `.env.example`**，注释掉 `VITE_STEPFUN_API_KEY`
5. **本地验证**：`bun run dev` + 录音测试
6. **部署 Workers**，**部署前端**

---

## 风险点

| 风险 | 说明 | 缓解措施 |
|------|------|---------|
| DashScope 模型名称不确定 | `paraformer-realtime-v2` 是主流，但版本可能更新 | 先测试，在 Workers 侧配置 model 名，方便切换 |
| 音频格式兼容性 | StepFun 接受 .webm；DashScope 对 webm 支持情况需验证 | Workers 可做格式透传，失败时考虑在 Workers 侧做格式转换（但 Cloudflare Workers 无法用 ffmpeg） |
| Workers 的 FormData 转发 | Cloudflare Workers 的 FormData 处理与 Node.js 有差异 | 参考 `cosyvoice-clone.ts` 的实现，该文件已有 FormData 上传先例 |
| 迁移后无直连模式 | 本地开发需要 Workers 运行（或用 wrangler dev） | 维护 `VITE_DASHSCOPE_API_KEY` 直连模式作为开发备选，生产走 Workers |
| Cloudflare Workers 请求体大小限制 | 免费版 Workers 请求体上限 100MB，音频通常 < 1MB | 无风险 |

---

## 附：关键文件路径

| 文件 | 路径 |
|------|------|
| 现有 ASR Hook | `src/hooks/useStepfunASR.ts` |
| 现有错误处理 | `src/utils/stepfunErrors.ts` |
| 调用方页面 | `src/pages/UsagePage.tsx`（L41-47 引入 hook，L105 调用 `transcribe()`） |
| TTS hook 参考 | `src/hooks/useCosyVoiceTTS.ts`（目标调用模式） |
| Workers 入口 | `workers/api/src/index.ts` |
| Workers 环境变量 | `workers/api/src/env.ts`（`DASHSCOPE_API_KEY` 已存在） |
| Voice Clone 参考 | `workers/api/src/cosyvoice-clone.ts`（FormData 转发先例） |

---

## 结论

迁移难度：**低**。DashScope 兼容模式 ASR 与 StepFun ASR 接口格式几乎完全相同（均为 OpenAI 兼容 multipart 上传，响应 `{ text }`）。主要工作是：
1. 新增一个约 50 行的 Workers handler
2. 修改前端 hook 约 15 行（换端点 + 去掉直连分支）
3. 删除前端环境变量 `VITE_STEPFUN_API_KEY`

整体改动范围小，架构上反而更安全（API key 从前端移到服务端）。
