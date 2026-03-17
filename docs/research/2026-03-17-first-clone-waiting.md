# 首次录音等待克隆逻辑调研

- 日期: 2026-03-17
- 级别: L1
- 来源:
  - `public/docs/v2d-设计文档-首次克隆等待与UX优化.md`
  - `src/pages/UsagePage.tsx`
  - `src/hooks/useAudioRecorder.ts`
  - `src/hooks/useStepfunASR.ts`

## 关键发现

1. 录音链路已经在 `useAudioRecorder.stopRecording({ includeWav })` 支持按需生成 WAV，页面层可以决定是否带 WAV，无需改 hook。
2. `useStepfunASR.transcribe` 返回识别文本，满足声音克隆所需 `referenceText` 依赖，因此克隆应继续放在 `UsagePage.handleStop` 内串接。
3. `useStepfunTTS` 已暴露 `cloneVoice` / `isCloning` / `voiceId`，页面层只需要改变等待策略，不需要修改 TTS hook。
4. 现有首次克隆是 fire-and-forget，需要改为:
   - `<5s`: toast 提示并直接默认音色朗读
   - `>=5s`: 进入 `cloning` 状态，等待克隆结果或 20s 超时后再朗读
5. 设计文档要求只上传前 10s WAV，最小实现是新增纯工具函数 `truncateWav`，从 header 推导字节率并重写 `ChunkSize` / `Subchunk2Size`。

## 推荐实现

- 新增 `src/utils/audioUtils.ts`，提供 `truncateWav(wavBlob, maxSeconds)`。
- 在 `UsagePage` 中新增 `FlowState = 'cloning'`。
- `handleStop` 顺序:
  1. `stopRecording({ includeWav: !voiceId })`
  2. `transcribe(webmBlob)`
  3. 首次且 `text` 存在时:
     - `<5s`: `toast.info(...)`
     - `>=5s`: `setFlowState('cloning')` -> `truncateWav(wavBlob, 10)` -> `Promise.race([onCloneVoice(...), 20s timeout])`
  4. `onSpeak(text)` -> `result`
- UI 增加 `cloning` 状态文本和子文本；处理卡片显示条件包含 `cloning`。

## 风险

- `Promise.race` 的超时不会取消底层克隆请求，只是停止等待。这与设计文档一致，但需要继续保留现有父层容错。
- `UsagePage` 同时接收 `isCloning` prop 和本地 `flowState='cloning'`，两者语义不同:
  - `isCloning`: 全局/父层的后台克隆状态提示
  - `flowState='cloning'`: 本次录音停止后的阻塞等待态
- `truncateWav` 依赖标准 44 字节 WAV header，这与当前 `useAudioRecorder.convertToWav` 输出一致。
