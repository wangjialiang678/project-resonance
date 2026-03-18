# 架构迁移指南

**目标读者**：接手后端/全栈开发的工程师，以及他们的 AI 助手。

---

## 1. 迁移概览

本次迁移将 Project Resonance 从 **Supabase（PostgreSQL + Edge Functions + Auth）** 全面迁移到 **Cloudflare Workers + localStorage 离线优先** 架构，同时将 ASR 从前端直连 StepFun 改为经 Workers 代理的 DashScope `qwen3-asr-flash`。

- **迁移日期**：2026-03-17 ~ 2026-03-18
- **分支**：`v2b-clone-decoupled`（基于 worktree `agent-a417ebcb`）
- **关键 commit 区间**：`d1a9ac4`（移除 Supabase）→ `46a70d6`（代码审查修复完成）

---

## 2. 架构对比

| 层面 | Before | After |
|------|--------|-------|
| **认证** | Supabase Auth + SMS OTP（百度云/七牛）| 无认证，localStorage 离线优先 |
| **用户数据存储** | Supabase PostgreSQL（profiles、phrases、recordings） | localStorage 全量本地（key：`resonance_phrases`、`resonance_settings`、`resonance_recordings`） |
| **API 后端** | Supabase Edge Functions（Deno 运行时） | Cloudflare Workers（TypeScript，单 Worker 多路由） |
| **ASR** | StepFun ASR（前端 WebSocket 直连，API Key 暴露在前端） | DashScope `qwen3-asr-flash`（Workers 代理，`POST /dashscope-asr`，API Key 在服务端） |
| **TTS** | DashScope CosyVoice（已有 Workers 代理） | 保持不变（`POST /cosyvoice-tts`） |
| **声音克隆** | DashScope + OSS（已有 Workers 代理） | 保持不变（`POST /cosyvoice-voice-clone`），修复了 OSS 清理 |
| **前端安全** | `VITE_STEPFUN_API_KEY` 直接在 build 产物中 | API Key 全部在服务端，前端只持有轻量 `VITE_APP_TOKEN` |
| **鉴权机制** | Supabase JWT | `X-App-Token` 请求头 + `WORKER_AUTH_SECRET` 验证 |
| **CORS** | Supabase 内置 | 白名单精确匹配（`ALLOWED_ORIGINS`），未知 Origin 不返回 `Access-Control-Allow-Origin`，响应头含 `Vary: Origin` |

---

## 3. Workers API 端点详解

**Workers 基础 URL**：`https://project-resonance-api.project-resonance.workers.dev`

所有端点均需在请求头携带 `X-App-Token`。

### 鉴权机制说明

Worker 在处理任何业务路由前，先校验请求头 `X-App-Token` 是否等于环境变量 `WORKER_AUTH_SECRET`。

```
// workers/api/src/index.ts
function validateAppToken(request, env, origin) {
  const expectedToken = env.WORKER_AUTH_SECRET?.trim();
  if (!expectedToken) return null;          // 未配置时跳过鉴权（本地开发用）
  const actualToken = request.headers.get("X-App-Token")?.trim();
  if (actualToken === expectedToken) return null;
  return corsResponse(JSON.stringify({ error: "Forbidden" }), 403, ...);
}
```

`WORKER_AUTH_SECRET` 未配置时，鉴权静默跳过（方便本地 `wrangler dev`）。生产环境必须配置。

---

### POST /cosyvoice-tts

**文件**：`workers/api/src/cosyvoice-tts.ts`

**请求**：
```
POST /cosyvoice-tts
Content-Type: application/json
X-App-Token: <WORKER_AUTH_SECRET>

{
  "text": "你好，请帮我倒杯水",
  "voice": "longanyang"        // 可选，默认 "longanyang"；传 voice_id 使用克隆音色
}
```

**响应**：
- `200 OK`，`Content-Type: audio/mpeg`，body 为 MP3 二进制数据
- `400`：`text` 缺失
- `500`：DashScope 上游错误或超时（30s）

**实现细节**：Cloudflare Workers 的 `fetch()` WebSocket upgrade 会自动剥除 `Authorization` 头，无法用于 DashScope WebSocket。因此 TTS 使用 `cloudflare:sockets` 的 `connect()` API 建立原始 TLS 连接，手动做 HTTP Upgrade 握手并在请求头中写入 `Authorization: Bearer ...`，然后手动解析 WebSocket 帧（含 continuation frame 分片处理）。

---

### POST /cosyvoice-voice-clone

**文件**：`workers/api/src/cosyvoice-clone.ts`

**请求**：
```
POST /cosyvoice-voice-clone
Content-Type: multipart/form-data
X-App-Token: <WORKER_AUTH_SECRET>

audio: <二进制音频文件>   // 字段名必须为 "audio"，最大 10MB
                          // 支持 WAV/MP3/WebM/OGG/FLAC
```

**响应**：
- `200 OK`：`{ "voice_id": "usr1a2b3c4..." }`
- `400`：文件缺失 / 过大 / 非 multipart
- `500`：OSS 上传失败 / DashScope Clone API 错误

**流程**：
1. 音频上传到阿里云 OSS（`voice-clone/<uuid>.<ext>`）
2. 生成预签名 GET URL（有效期 600 秒）
3. 调用 DashScope voice-enrollment API 创建音色，返回 `voice_id`
4. **无论成功失败，`finally` 块中删除 OSS 上的临时文件**（修复自 code-review C2）

---

### POST /dashscope-asr

**文件**：`workers/api/src/dashscope-asr.ts`

**请求**：
```
POST /dashscope-asr
Content-Type: multipart/form-data
X-App-Token: <WORKER_AUTH_SECRET>

file: <二进制音频文件>    // 字段名必须为 "file"，最大 5MB
                          // 支持 WAV/MP3/OGG/FLAC/WebM
```

**响应**：
- `200 OK`：`{ "text": "识别出的文字内容" }`（格式兼容 OpenAI transcription API）
- `400`：文件缺失 / 过大 / 非 multipart
- ASR 未识别到内容时：`{ "text": "" }`（非错误，由前端处理）

**实现细节**：DashScope 的 `transcriptions` endpoint 在测试中返回 404，改用 `qwen3-asr-flash` 的 chat completions 接口（`/compatible-mode/v1/chat/completions`），音频以 base64 data URI 方式传入 `input_audio.data`。

---

## 4. 前端 Hook 架构

```
UsagePage
├── useDashscopeASR        → 录音结束后，把 webm blob POST 到 /dashscope-asr
│                              返回识别文本
├── useCosyVoiceTTS
│   ├── speak()            → POST /cosyvoice-tts，blob 播放
│   ├── cloneVoice()       → POST /cosyvoice-voice-clone，存 voice_id 到 localStorage
│   ├── voiceId (state)    → 初始化从 localStorage.getItem('resonance_cosyvoice_voice_id')
│   └── cancelPendingClone()  → generation guard，防止超时后返回的旧克隆结果覆盖状态
└── useAppData             → 从 localStorage 读写 phrases/settings/recordings
```

### useDashscopeASR（原 useStepfunASR）

`src/hooks/useDashscopeASR.ts`

- 接收 `Blob`，用 `FormData` 的 `file` 字段 POST 到 `VITE_API_URL/dashscope-asr`
- 请求头自动携带 `X-App-Token: VITE_APP_TOKEN`
- 状态：`finalText`、`isProcessing`、`error`
- 错误信息经 `formatApiError()` 统一转为中文

### useCosyVoiceTTS

`src/hooks/useCosyVoiceTTS.ts`

- `speak(text, overrideVoice?)` — 优先用 `overrideVoice`，其次 `voiceId`（localStorage），最后 `DEFAULT_VOICE`（`longanyang`）
- 当 API 返回 404 或 400 且错误含 "not exist/not found" 时，自动清除失效 `voiceId` 并 fallback 到默认音色
- `cloneVoice(blob)` — 内部用 `cloneGenerationRef` 做 generation guard，避免并发克隆或超时后的竞态

### useAppData

`src/hooks/useAppData.ts`

- localStorage key：`resonance_phrases`、`resonance_settings`、`resonance_recordings`
- 录音 blob 以 data URL 序列化存储，加载时恢复为 Blob 对象
- 无任何网络请求，纯离线

---

## 5. 关键文件路径

### Workers 后端

```
workers/api/
├── src/
│   ├── index.ts              # 路由分发 + X-App-Token 鉴权
│   ├── env.ts                # 环境变量类型定义与校验
│   ├── cors.ts               # CORS 白名单 + corsResponse 工具
│   ├── dashscope-asr.ts      # ASR：qwen3-asr-flash via chat completions
│   ├── cosyvoice-tts.ts      # TTS：connect() 手动 WebSocket
│   └── cosyvoice-clone.ts    # 声音克隆：OSS 上传 → DashScope API → finally 清理
├── wrangler.toml             # Workers 配置（name、main、compatibility_date）
└── tsconfig.json             # Workers 独立 TS 配置
```

### 前端 Hooks

```
src/hooks/
├── useDashscopeASR.ts        # ASR（迁移自 useStepfunASR）
├── useCosyVoiceTTS.ts        # TTS + 声音克隆
├── useAppData.ts             # 所有用户数据（localStorage）
├── useAudioRecorder.ts       # 麦克风录音（WebM + WAV 双格式）
└── useWechatBridge.ts        # 微信小程序 JS-SDK 录音桥接
```

### 前端页面

```
src/pages/
├── UsagePage.tsx             # 主页：录音 → ASR → 首次克隆 → TTS
├── SettingsPage.tsx          # 设置：ASR 面板 + VoiceClonePanel
└── WelcomePage.tsx           # 引导页（已更新隐私说明）
```

### 前端组件

```
src/components/
├── ASRSettingsPanel.tsx      # ASR 配置（仅展示 DashScope 状态，无 API Key 输入）
├── VoiceClonePanel.tsx       # 声音克隆 UI（录制/上传 + 克隆 + 试听 + 清除）
└── ...
```

### 工具

```
src/utils/
├── apiErrors.ts              # HTTP 状态码 → 中文错误信息（formatApiError）
└── audioUtils.ts             # WAV 截断（truncateWav，限 10s 送克隆）
```

### 配置文件

```
.env                          # 前端环境变量（VITE_API_URL + VITE_APP_TOKEN）
src/types/index.ts            # 核心类型（Phrase、ASRSettings 等）
```

---

## 6. 环境配置与部署

### 前端环境变量（`.env`）

```bash
VITE_API_URL=https://project-resonance-api.project-resonance.workers.dev
VITE_APP_TOKEN=resonance-2026    # 与 WORKER_AUTH_SECRET 相同值
```

### Workers Secrets（wrangler deploy 时传入）

| 变量名 | 说明 |
|--------|------|
| `DASHSCOPE_API_KEY` | 阿里云 DashScope API Key（TTS + ASR + 声音克隆） |
| `OSS_BUCKET` | 阿里云 OSS Bucket 名称 |
| `OSS_ENDPOINT` | OSS Endpoint（如 `oss-cn-shanghai.aliyuncs.com`） |
| `OSS_ACCESS_KEY_ID` | OSS AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | OSS AccessKey Secret |
| `WORKER_AUTH_SECRET` | 与前端 `VITE_APP_TOKEN` 一致的鉴权 token |

### 本地开发

```bash
# 安装依赖
npm install --legacy-peer-deps

# 前端 dev server（:8080）
npm run dev

# Workers 本地调试（单独终端）
cd workers/api
npx wrangler@4 dev
```

### 部署命令

**Workers API：**

```bash
cd workers/api
export $(grep '^DASHSCOPE_API_KEY=' ~/.claude/api-vault.env)
export $(grep '^OSS_' ~/.claude/api-vault.env)
export WORKER_AUTH_SECRET=resonance-2026

npx wrangler@4 deploy \
  --var DASHSCOPE_API_KEY:$DASHSCOPE_API_KEY \
  --var OSS_ACCESS_KEY_ID:$OSS_ACCESS_KEY_ID \
  --var OSS_ACCESS_KEY_SECRET:$OSS_ACCESS_KEY_SECRET \
  --var OSS_BUCKET:$OSS_BUCKET \
  --var OSS_ENDPOINT:$OSS_ENDPOINT \
  --var WORKER_AUTH_SECRET:$WORKER_AUTH_SECRET
```

**前端（Cloudflare Pages）：**

```bash
npx vite build && npx wrangler pages deploy dist --project-name project-resonance
```

### 注意事项

- **`--legacy-peer-deps`**：前端依赖有版本冲突，npm install 必须加此参数
- **wrangler v4 secrets 不累积**：`wrangler secret put` 和 `wrangler deploy` 创建独立版本，secrets 不会自动合并进新 deploy。**必须在 `deploy` 时用 `--var` 一次性传入所有变量**
- **TTS 的 `cloudflare:sockets`**：Workers `fetch()` WebSocket upgrade 会剥除 `Authorization` 头，所以 TTS handler 用 `connect()` 做手动握手。TypeScript 中用 `// @ts-ignore` 注释引用，因为没有官方类型声明
- **Cloudflare Pages 500 次/月构建限额**：免费版

---

## 7. 已删除的文件/功能

| 文件/目录 | 删除原因 |
|-----------|----------|
| `supabase/` 整个目录 | 迁移到 Cloudflare Workers，不再需要 |
| `src/integrations/supabase/` | Supabase 客户端 SDK 依赖 |
| `src/pages/AuthPage.tsx` | 移除登录认证层（离线优先，无需账号） |
| `src/pages/ResetPasswordPage.tsx` | 同上 |
| `src/hooks/useAuth.ts` | Supabase Auth hook |
| `src/hooks/useStepfunTTS.ts` | StepFun TTS 前端直连实现（API Key 在前端，安全风险） |
| `src/hooks/useStepfunASR.ts` | 重命名为 `useDashscopeASR.ts`，逻辑完全重写 |
| `src/utils/stepfunErrors.ts` | 重命名为 `src/utils/apiErrors.ts`，改为 provider 无关命名 |
| `VITE_STEPFUN_API_KEY` | API Key 移至服务端，前端不再需要 |

---

## 8. 已知限制和后续建议

### 已解决（本次迁移修复）

| 原问题 | 修复方式 |
|--------|---------|
| Workers 无鉴权，任意人可消耗 API 额度 | 添加 `X-App-Token` + `WORKER_AUTH_SECRET` 验证 |
| OSS 音频在克隆失败时不清理 | `ossDelete` 移入 `finally` 块，成功失败均清理 |
| 克隆超时后晚到响应仍会覆盖 voiceId | `cloneGenerationRef` generation guard |
| WebSocket 分片（continuation frame）未处理 | `cosyvoice-tts.ts` 补齐分片拼装逻辑 |
| Workers TypeScript 编译失败 | 修复 `Uint8Array` 泛型、socket options 类型 |
| 引导页声称"全程离线"与实际不符 | 更新文案：明确 ASR/克隆依赖网络 |
| 小程序仍调 `/stepfun-asr`（404） | `miniprogram/pages/record/*.js` 改为 `/dashscope-asr` |
| 前端允许 20MB 克隆文件，服务端拒绝 10MB | 统一为 10MB |
| CORS 未拒绝未知 Origin，缺少 `Vary: Origin` | 白名单精确匹配，补 `Vary: Origin` |

### 仍存在的限制

1. **`X-App-Token` 是静态 token**，前端 build 产物中可见（`VITE_APP_TOKEN`），仍可被有意者提取后直接调用 Workers。更强的方案是 Cloudflare Turnstile / Access，或基于时间的签名 token，但会增加前端复杂度。

2. **无速率限制**：当前鉴权只验证 token 合法性，没有按 IP 或设备的请求频次控制。高频调用仍会消耗 DashScope 和 OSS 额度。

3. **localStorage 无容量保证**：录音 data URL 存 localStorage，单条录音约 500KB~2MB，多条录音可能触及浏览器 5~10MB 上限。大量训练数据的项目应考虑 IndexedDB。

4. **声音克隆无持久化**：`voice_id` 仅存 localStorage，换设备或清除浏览器数据后丢失，需重新克隆。DashScope 侧的音色实际上不会自动删除，但前端无法感知已有音色。

5. **ASR 仅支持 DashScope**：原有 StepFun/火山引擎 双 provider 能力已移除，`useVolcengineASR.ts` 文件保留但未接入主链路。
