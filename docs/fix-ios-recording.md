# Fix: iOS/Safari 录音兼容性

## 问题

手机（iOS Safari）和部分设备上语音识别失败：
- "未能识别到语音内容，请重试"
- "Load failed"（Safari 原生的 fetch 错误）

## 根因

`src/hooks/useAudioRecorder.ts` 第 80-83 行：

```typescript
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm',
```

**iOS Safari 不支持 `audio/webm`**。Safari 的 MediaRecorder 只支持 `audio/mp4`（或 `audio/aac`）。
当 `audio/webm` 不支持时，fallback 仍然是 `audio/webm`，导致 MediaRecorder 构造失败或录出无效数据。

第 160 行 blob 类型也硬编码为 `audio/webm`：
```typescript
const webmBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
```

## 修复方案

### 1. `src/hooks/useAudioRecorder.ts`

**MIME 类型检测**（替换第 80-83 行）：

```typescript
// Detect best supported audio MIME type
function getSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',        // iOS Safari
    'audio/aac',        // iOS fallback
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return ''; // browser default
}
```

在 `startRecording` 中：
```typescript
const mimeType = getSupportedMimeType();
const options: MediaRecorderOptions = { audioBitsPerSecond: 24000 };
if (mimeType) options.mimeType = mimeType;
const mediaRecorder = new MediaRecorder(stream, options);
```

**保存实际 MIME 类型到 ref**（用于 stopRecording 时设置正确的 blob type）：

添加一个 ref：
```typescript
const mimeTypeRef = useRef<string>('audio/webm');
```

在 `startRecording` 中：
```typescript
mimeTypeRef.current = mimeType || 'audio/webm';
```

**stopRecording 中使用实际 MIME 类型**（替换第 160 行）：
```typescript
const webmBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
```

### 2. `RecordingResult` 接口

`webmBlob` 名字有歧义但改名影响大，保持不变，只是实际 type 可能是 `audio/mp4`。加注释说明：

```typescript
interface RecordingResult {
  /** Compressed audio blob (webm on Chrome/Android, mp4 on iOS Safari) */
  webmBlob: Blob;
  ...
}
```

### 3. `src/hooks/useDashscopeASR.ts`

第 32 行 filename 应该反映实际类型：
```typescript
// Use correct file extension based on blob type
const ext = audioBlob.type.includes('mp4') ? 'mp4'
          : audioBlob.type.includes('aac') ? 'aac'
          : audioBlob.type.includes('ogg') ? 'ogg'
          : 'webm';
formData.append('file', audioBlob, `recording.${ext}`);
```

### 4. Workers `dashscope-asr.ts` — 无需改动

已有 `mimeFromName()` 和 `audioFile.type` fallback，能正确处理 mp4/aac。

### 5. `src/utils/apiErrors.ts`

添加 Safari 的 "Load failed" 错误识别。在 `formatApiError` 或调用处：
```typescript
// Safari uses "Load failed" instead of "Failed to fetch"
if (message === 'Load failed') {
  return '网络连接失败，请检查网络后重试';
}
```

## 测试验证

修复后需在以下环境测试：
1. **Chrome 桌面** — 应使用 `audio/webm;codecs=opus`
2. **iOS Safari** — 应使用 `audio/mp4`
3. **Android Chrome** — 应使用 `audio/webm;codecs=opus`
4. **微信内置浏览器** — 应使用可用格式

验证方法：打开 Console，看 `[handleStop]` 日志中 blob type 是否正确。

## 文件清单

| 文件 | 改动 |
|------|------|
| `src/hooks/useAudioRecorder.ts` | MIME 检测 + 动态 blob type |
| `src/hooks/useDashscopeASR.ts` | 文件扩展名匹配 blob type |
| `src/utils/apiErrors.ts` | 识别 Safari "Load failed" |
