# 设计文档：首次克隆等待与 UX 优化 v2d

> 版本：v2d | 日期：2026-03-17 | 状态：已实现并测试通过

## 一、设计目标

在 v2c（静默后台克隆）基础上优化首次录音体验：
1. **首次录音 ≥5s**：等待克隆完成，用克隆声音朗读（而非默认音色）
2. **首次录音 <5s**：提示用户录音不足，用默认音色朗读
3. **克隆容错**：超时或失败时自动降级到默认音色，不阻塞用户
4. **音频截取**：只上传前 10s WAV 用于克隆，减少上传时间和 API 耗时
5. **设置页整合**：快捷链接改为"声音克隆"，试听合并到克隆面板内

---

## 二、关键技术参数

### 2.1 克隆耗时模型

基于实测数据（2026-03-17）：
- 10s 音频（697KB WAV）→ API 响应 ~10s
- 比例约 1:1（音频时长 : API 耗时）
- 带参考文本（reference text）比不带快且成功率高

### 2.2 超时计算

| 截取长度 | 预估 API 耗时 | 等待超时 | 说明 |
|----------|--------------|---------|------|
| 5-10s    | 5-10s        | 20s     | 正常场景，留 10s 余量 |
| 10s (max)| ~10s         | 20s     | 截取上限 |

**等待超时 = 20s**（固定值，因为音频已截取到 ≤10s）

### 2.3 WAV 截取规格

- 格式：PCM 16-bit, 16kHz, 单声道
- 头部：44 字节标准 WAV header
- 每秒数据量：16000 × 2 = 32000 字节
- 10s 截取大小：44 + 320000 = 320044 字节（~312KB）
- 截取方式：保留 WAV header，截断 PCM 数据，**更新 header 中的文件大小和数据大小字段**

---

## 三、交互流程

### 3.1 使用页（UsagePage）首次录音流程

```
用户录音 → 停止
├── duration < 5s 且 !voiceId：
│   ├── toast: "录音不足5秒，将用默认音色朗读，下次多说几句就能学习你的声音"
│   ├── ASR(webm) → text
│   └── TTS(text, 默认音色) → 朗读
│
├── duration ≥ 5s 且 !voiceId：
│   ├── ASR(webm) → text （与克隆并行启动）
│   ├── 截取 WAV 前10s → cloneVoice(truncatedWav, text)
│   ├── UI: "正在学习你的声音..."
│   ├── 等待克隆（最多20s）：
│   │   ├── 成功: toast "已学习你的声音" → TTS(text, 克隆音色)
│   │   └── 失败/超时: toast "声音学习未完成，先用默认音色" → TTS(text, 默认音色)
│   └── → 朗读 → 结果页
│
└── 已有 voiceId：
    ├── ASR(webm) → text
    └── TTS(text, 克隆音色) → 朗读（现有逻辑不变）
```

### 3.2 并行与等待策略

```
时间轴（首次 ≥5s）：
t=0   停止录音
t=0   ┌── ASR 开始（webm，~2s）
      └── 截取 WAV（同步，<10ms）
t=2   ASR 完成，得到 text
t=2   cloneVoice 开始（truncated WAV + text）
t=2   UI: "正在学习你的声音..."
t=12  克隆完成（~10s）
t=12  TTS 开始（用克隆音色）
t=14  开始朗读

如果 t=22 仍未完成（超时）：
t=22  放弃等待
t=22  TTS 开始（用默认音色）
t=24  开始朗读
```

注意：ASR 必须先完成才能启动克隆（需要 reference text）。这是串行依赖。

### 3.3 FlowState 扩展

```typescript
type FlowState = 'idle' | 'recording' | 'processing' | 'cloning' | 'speaking' | 'result';
//                                                       ^^^^^^^^ 新增
```

| FlowState    | UI 显示 |
|-------------|---------|
| `processing` | "正在识别语音..." |
| `cloning`    | "正在学习你的声音..."（带进度提示） |
| `speaking`   | "正在朗读..." |

---

## 四、WAV 截取实现

```typescript
/**
 * 截取 WAV blob 的前 maxSeconds 秒
 * 假设：标准 44 字节 WAV header, PCM 16-bit, 16kHz, mono
 */
function truncateWav(wavBlob: Blob, maxSeconds: number): Promise<Blob> {
  // 1. 读取 ArrayBuffer
  // 2. 解析 header: sampleRate, bitsPerSample, numChannels
  // 3. 计算 maxBytes = sampleRate * (bitsPerSample/8) * numChannels * maxSeconds
  // 4. 截断数据区
  // 5. 更新 header 中的 ChunkSize (offset 4) 和 Subchunk2Size (offset 40)
  // 6. 返回新 Blob
}
```

放置位置：`src/utils/audioUtils.ts`（新文件）

---

## 五、设置页改动

### 5.1 快捷链接

```diff
- { icon: Mic, label: '录音训练', path: '/training' }
+ { icon: Mic, label: '声音克隆', action: scrollToVoiceClone }
```

点击后滚动到 VoiceClonePanel 区域。

### 5.2 VoiceClonePanel 合并布局

**未克隆状态**（保持不变）：
- 标题："声音克隆"
- 提示：朗读「今天天气真不错，我想出去走走」
- 录制/上传按钮
- "开始复刻音色" 按钮

**已克隆状态**（合并试听）：
```
┌─────────────────────────────────┐
│ ✓ 声音已克隆                    │
│                                 │
│ [▶ 试听克隆音色]  [🗑 清除]     │
│                                 │
│ 如需更换，清除后重新录制         │
└─────────────────────────────────┘
```

- 试听和清除在同一行，紧凑布局
- 去掉独立的 Voice ID 显示（用户不需要看到技术细节）

---

## 六、文件改动清单

| 文件 | 改动 |
|------|------|
| `src/utils/audioUtils.ts` | **新建** — truncateWav 工具函数 |
| `src/pages/UsagePage.tsx` | 首次录音等待克隆逻辑、FlowState 扩展、<5s 提示 |
| `src/pages/SettingsPage.tsx` | 快捷链接改为"声音克隆"、滚动到锚点 |
| `src/components/VoiceClonePanel.tsx` | 已克隆状态合并布局、去掉 Voice ID 显示、清除前停止播放 |
| `src/hooks/useStepfunASR.ts` | 新增直连模式（VITE_STEPFUN_API_KEY） |
| `src/hooks/useStepfunTTS.ts` | 新增直连模式（VITE_STEPFUN_API_KEY），speak + cloneVoice 双路径 |

---

## 七、本地开发直连模式

为解决团队成员无 Supabase Dashboard 权限时的本地测试问题，hooks 新增 **直连模式**：

```bash
# .env.local（不提交到 git）
VITE_STEPFUN_API_KEY=your-stepfun-api-key
```

**工作原理**：当 `VITE_STEPFUN_API_KEY` 存在时，`useStepfunASR` / `useStepfunTTS` 直接调用 StepFun API，跳过 Supabase Edge Function 代理层。不存在时走原有 Supabase 代理路径，无需改动。

**注意**：直连模式仅用于本地开发测试。生产环境必须走 Supabase Edge Function（隐藏 API Key）。

---

## 八、已修复的关键 Bug

### 8.1 voiceId 闭包问题（Critical）
`handleStop` 中 `cloneVoice` 成功后 `setVoiceId(newId)` 更新了 state，但同一 render 内 `onSpeak` 的闭包仍捕获旧的 `voiceId=null`。
**修复**：`onSpeak(text, overrideVoice?)` 接受可选参数，克隆成功后显式传入 `onSpeak(text, clonedVid)`。

### 8.2 Promise.race 超时泄漏（Warning）
`Promise.race([clonePromise, timeoutPromise])` 中，如果克隆先完成，`setTimeout` 仍在运行。
**修复**：保存 `timeoutId`，race 结束后 `clearTimeout(timeoutId!)`。

### 8.3 VoiceClonePanel 清除不停播放（Warning）
用户点击"清除"时，如果克隆声音正在播放，不会停止。
**修复**：`onClick` 中先 `if (isSpeaking) onStop()` 再 `onClearVoice()`。

### 8.4 truncateWav 非 WAV 输入（Warning）
非 WAV 格式或损坏的 blob 传入 `truncateWav` 会导致异常。
**修复**：校验 RIFF/WAVE 魔数和 sampleRate/channels/bitsPerSample 非零，无效输入返回原 blob。

---

## 九、容错矩阵

| 场景 | 处理 | 用户感知 |
|------|------|---------|
| 首次 <5s | 默认音色 TTS | toast: "录音不足5秒..." |
| 首次 ≥5s, 克隆成功 | 克隆音色 TTS | toast: "已学习你的声音" |
| 首次 ≥5s, 克隆超时(>20s) | 默认音色 TTS | toast: "声音学习超时，先用默认音色" |
| 首次 ≥5s, 克隆失败 | 默认音色 TTS | toast: "声音学习未成功，先用默认音色" |
| 首次 ≥5s, ASR 无文本 | 不触发克隆 | 显示"未能识别" |
| 已有 voiceId | 正常流程 | 无额外提示 |
| voiceId 过期 | TTS 自动回退默认 | 下次录音重新学习 |

---

## 十、测试验证记录（2026-03-17）

### API 级测试
| API | 结果 |
|-----|------|
| TTS 生成 10.5s WAV | OK (507KB) |
| ASR 识别 WAV 音频 | OK "今天天气真不错..." |
| 文件上传 + 声音克隆 | OK voice-tone-PUGbvqAcgi |
| 克隆声音 TTS | OK (48KB MP3) |

### UI 集成测试（自动化，MockMediaRecorder + 注入测试音频）
| 步骤 | 结果 |
|------|------|
| 首次录音 >5s, needClone=true | OK |
| ASR 直连模式识别 | OK |
| WAV 截断 (1012K→960K, ~10s) | OK |
| "正在学习你的声音..." UI 状态 | OK |
| 克隆成功, voiceId 获取 | OK |
| overrideVoice 传参绕过闭包 | OK |
| TTS 用克隆声音朗读 | OK |
| 结果页展示 | OK |

### 提交记录
- `28513d8` fix: review fixes + add direct StepFun API mode for local dev
- `1ec18bb` Merge settings UX branch
- `9d1493f` feat: wait for first voice clone before speak
- `24c15f5` fix: pass reference text to voice clone API + add v2d design doc
