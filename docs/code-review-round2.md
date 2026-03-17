---
title: Code Review Round 2
date: 2026-03-17
status: active
audience: both
---

# 审查范围

基于 `git diff 22880d4..HEAD` 审查 `v2b-clone-decoupled` 分支本轮改动，重点覆盖：

- Supabase 移除
- Cloudflare Workers API 后端
- ASR 从 StepFun 迁移到 DashScope
- UX 修复
- API Key 后移到服务端后的安全面

补充验证：

- `npm run build`：通过
- `npm run lint`：失败；其中新增 Worker 文件有 `workers/api/src/cosyvoice-tts.ts:11` 的 lint 问题
- `npx tsc -p workers/api/tsconfig.json`：失败

# Critical

## 1. Workers 后端当前是一个无鉴权的公网代理，任何人都可以消耗你们的 DashScope / OSS 额度

文件路径、行号：
`workers/api/src/index.ts:17-42`
`workers/api/src/cors.ts:1-29`

问题描述：
三个高成本接口都直接暴露在公网，代码里没有任何鉴权、签名校验、速率限制、配额限制或 anti-abuse 机制。当前 CORS 白名单不是访问控制，只能限制浏览器脚本；服务端请求、curl、脚本工具都可以直接调用 Worker。也就是说，API Key 虽然从前端移走了，但等价地变成了一个任何人都能打的公开后端代理。

建议修复：
增加真正的服务端访问控制，例如短期签名/JWT、Cloudflare Access/Turnstile、每 IP / 每设备限流和配额、请求 nonce 校验；同时把未知 Origin 明确拒绝，而不是继续返回默认 Origin。

## 2. 声音克隆上传到 OSS 的用户音频只在成功路径清理，失败时会遗留敏感语音样本

文件路径、行号：
`workers/api/src/cosyvoice-clone.ts:153-166`
`workers/api/src/cosyvoice-clone.ts:173-215`
`workers/api/src/cosyvoice-clone.ts:204-209`

问题描述：
音频一旦上传成功，后续任意失败路径都会在到达 `ossDelete()` 之前提前返回或抛错，包括克隆 API 返回错误、上游返回非 JSON、`voice_id` 缺失、运行时异常等。结果是最敏感的用户语音数据恰恰会在失败场景下长期留在 OSS 中，这和“安全后移”“隐私保护”的目标相冲突。

建议修复：
拿到 `objectKey` 之后，把 OSS 删除放进 `finally`，确保成功和失败都执行清理；删除失败时至少打出可检索告警并补一个异步重试/过期生命周期策略。

# Warning

## 1. 小程序录音页仍然请求已删除的 `/stepfun-asr`，迁移后该链路会直接 404

文件路径、行号：
`miniprogram/pages/record/index.js:142-148`
`miniprogram/pages/record/record.js:142-148`
`workers/api/src/index.ts:34-40`

问题描述：
Worker 现在只暴露 `/dashscope-asr`，但小程序页面仍然上传到 `/stepfun-asr`，而且还保留了 `model: 'step-asr'` 的旧参数。结果是微信原生录音识别链路在本分支上已经断掉，和“Supabase 完全移除 + Workers ASR 后端接管”的目标不一致。

建议修复：
把两个小程序页面统一改到 `/dashscope-asr`，删除 StepFun 专属注释和表单字段，并补一个最小联调或 smoke test 覆盖该上传链路。

## 2. 首次录音的“20 秒等待后降级”只是 UI 超时，不会取消克隆请求，存在晚到结果覆盖状态的竞态

文件路径、行号：
`src/pages/UsagePage.tsx:119-125`
`src/pages/UsagePage.tsx:127-145`
`src/hooks/useCosyVoiceTTS.ts:150-179`
`src/hooks/useCosyVoiceTTS.ts:196-198`

问题描述：
页面层用 `Promise.race` 在 20 秒后先走降级朗读，但真正的克隆请求仍会继续跑到 90 秒。只要后端晚点成功，`useCosyVoiceTTS` 仍会执行 `setVoiceId()`，导致用户在已经看到“声音学习未完成”甚至手动点了“换人”之后，又被一个过期请求悄悄写回新的音色 ID。

建议修复：
把 `AbortSignal` 从页面层传进克隆 hook，在 UI 超时时真正取消请求；或者至少用 request id / generation guard，忽略超时后返回的旧响应。

## 3. 新增的 Workers 代码在自己的严格 TS 配置下无法通过编译，类型安全并未真正建立起来

文件路径、行号：
`workers/api/src/cosyvoice-tts.ts:11`
`workers/api/src/cosyvoice-tts.ts:118`
`workers/api/src/cosyvoice-tts.ts:190`
`workers/api/src/env.ts:13`
`workers/api/src/index.ts:26`

问题描述：
`npx tsc -p workers/api/tsconfig.json` 直接失败，涉及 socket options、`Uint8Array` 类型和 `validateEnv()` 的断言签名。也就是说，这个最核心的新后端目前并没有处在可被严格类型检查保护的状态，后续回归很难在 CI 阶段及时挡住。

建议修复：
修正 `Env` 断言签名、socket options 类型和 `Uint8Array` 泛型不匹配问题，并把 Worker 的 typecheck 加入正式脚本/CI。

## 4. TTS 的手写 WebSocket 解析器没有处理 continuation frame，遇到分片消息会丢数据

文件路径、行号：
`workers/api/src/cosyvoice-tts.ts:70-112`
`workers/api/src/cosyvoice-tts.ts:192-211`

问题描述：
当前解析器只按 `0x1` 文本帧和 `0x2` 二进制帧处理，没有处理 `0x0` continuation frame，也没有按 FIN 位拼装分片消息。一旦 DashScope 或中间网络层把文本控制消息/音频帧分片发送，代码会直接忽略这些片段，表现为音频截断、任务永远等不到 `task-finished` 或随机超时。

建议修复：
补齐 WebSocket 分片消息处理，或者换成在 Workers 环境里被验证过的 WS 客户端实现，避免自己维护协议细节。

## 5. 引导页仍然宣称“全程离线运行”，但本分支实际上会把音频发到 Workers、DashScope 和 OSS

文件路径、行号：
`src/pages/WelcomePage.tsx:27-33`
`workers/api/src/dashscope-asr.ts:64-82`
`workers/api/src/cosyvoice-clone.ts:137-186`

问题描述：
这轮迁移后，识别和克隆都已经依赖云端服务，但引导页仍告诉用户“全程离线运行，保护您的隐私”。这不是简单文案偏差，而是和真实数据流相反，尤其在声音克隆还会经过 OSS 的情况下，容易引发用户信任和合规问题。

建议修复：
同步更新引导页和隐私说明，明确哪些能力依赖网络、语音数据会流经哪些服务、保存多久、失败是否清理。

# Suggestion

## 1. StepFun 直连能力和相关命名还残留在代码树里，既增加认知噪音，也保留了把 API Key 放回前端的回退路径

文件路径、行号：
`src/hooks/useStepfunTTS.ts:80-211`
`src/hooks/useStepfunASR.ts:19-24`
`src/utils/stepfunErrors.ts:1-42`
`src/AppRoutes.tsx:58-67`
`.env:3`
`.env.local:1`
`src/types/index.ts:26-43`

问题描述：
虽然运行时主链路已经切到 Workers，但仓库里仍保留了 `useStepfunTTS` 的前端直连实现、`VITE_STEPFUN_API_KEY` 模板、`stepfun` 命名的 hook / error helper，以及默认 `ASR provider = 'stepfun'` 的类型定义。这些残留会让后续维护者误以为前端直连仍是受支持路径，也让“API Key 已完全移到服务端”的结论不够干净。

建议修复：
删除不再使用的 StepFun 直连 hook 和 env 模板，把公用错误处理重命名为 provider-agnostic 名称，并把 ASR 配置结构收敛到当前真实后端契约。

## 2. 前端允许上传 20MB 克隆音频，但 Worker 只接受 10MB，用户会在长时间上传后才失败

文件路径、行号：
`src/components/VoiceClonePanel.tsx:60-63`
`workers/api/src/cosyvoice-clone.ts:132-135`

问题描述：
设置页本地校验允许 20MB 音频，服务端却在 10MB 处直接拒绝。这样用户可以顺利选中文件、开始请求、等待上传，然后才收到后端错误，体验上像“随机失败”。

建议修复：
统一前后端的文件上限，并把真实限制写到按钮下方提示文案里。

## 3. CORS 实现方式偏宽松，未知 Origin 不会被显式拒绝，也缺少 `Vary: Origin`

文件路径、行号：
`workers/api/src/cors.ts:1-29`

问题描述：
`getAllowedOrigin()` 对未知或缺失 Origin 直接回退到生产 Pages 域名，而不是拒绝请求。这会掩盖环境配置问题，也让日志和调试更难理解；如果以后接入缓存层，缺少 `Vary: Origin` 也容易埋下响应头混用问题。

建议修复：
对不在白名单内的 Origin 直接返回 403；对允许的 Origin 原样回显；若继续做按 Origin 变化的响应头，补上 `Vary: Origin`。
