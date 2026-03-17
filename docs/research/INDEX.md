# Research Index

| Date | Topic | Level | Summary | Path |
| --- | --- | --- | --- | --- |
| 2026-03-17 | 首次录音等待克隆逻辑 | L1 | 复用现有 `UsagePage -> useAudioRecorder -> useStepfunASR -> onCloneVoice/onSpeak` 链路，仅在页面层增加 `cloning` 状态、10s WAV 截取和 20s 等待降级。 | [docs/research/2026-03-17-first-clone-waiting.md](/Users/michael/SuperBrain 超脑/project-resonance/.claude/worktrees/agent-a417ebcb-wt-5a3e201f/docs/research/2026-03-17-first-clone-waiting.md) |
| 2026-03-17 | Workers ASR 代理模式 | L2 | 推荐方案 B：解析 FormData 后重建转发到 StepFun，与 cosyvoice-clone.ts 模式一致。免费版 CPU 10ms 足够（I/O 不计入）；内存 128MB 对 <10MB 音频安全；不手动设 Content-Type 是关键。 | [docs/research/workers-asr-proxy-pattern.md](workers-asr-proxy-pattern.md) |
| 2026-03-17 | DashScope ASR API | L2 | 两条路径：(1) OpenAI 兼容同步接口 `compatible-mode/v1/audio/transcriptions`，支持 webm，格式与 StepFun 完全相同；(2) 异步文件转录 `/api/v1/services/audio/asr/transcription`，仅支持公网 URL，不支持直传。project-resonance 应用同步接口，模型 `paraformer-realtime-v2`。SenseVoice 即将下线。 | [docs/research/dashscope-asr-api.md](dashscope-asr-api.md) |
