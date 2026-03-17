# UX 修复方案 v2e — 引导流程 + 声音克隆对齐

> 日期：2026-03-17 | 状态：待实现

## 背景

用户测试发现两个 UX 回归问题：
1. 引导页（WelcomePage）包含过时的"录音训练"步骤，结束后跳转到 /training
2. 设置页声音克隆录制后报 "Failed to fetch"

v2d 设计已将声音克隆移到 UsagePage 首次录音自动触发，引导流程需要同步更新。

## 问题 1：WelcomePage 引导步骤过时

### 现状
WelcomePage 有 4 步：intro → phrases → training → usage
- Step 3 (id: 'training') 引导用户去录音训练——但 v2d 已不需要这步
- 最后一步按钮文案"开始训练"，跳转 `/training`
- 用户体验与 v2d 设计不一致

### 修改方案

**文件：`src/pages/WelcomePage.tsx`**

1. **删除 training 步骤**：移除 steps 数组中 id='training' 的对象（第 3 个步骤）

2. **更新 intro 步骤 details**：
   ```
   - '基于少量录音样本学习您的发音模式'
   + '说一句话，系统识别并转换为文字'
   - '识别固定短语并转换为文字'
   + '首次录音自动学习你的声音'
   ```
   保留后两条不变。

3. **更新 phrases 步骤**：
   - title: '第一步：准备词表' → '词表管理'
   - details 第一条: '前往「词表」页面管理短语' → '在「设置」→「词表管理」中管理短语'

4. **更新 usage 步骤**：
   - title: '第三步：开始使用' → '开始使用'
   - subtitle: '语音识别与文字输出' → '录音 → 识别 → 朗读'
   - description: 改为 '点击录音按钮说一句话，系统会识别语音内容并通过语音合成朗读出来。首次录音超过 5 秒时，系统会自动学习你的声音特征。'
   - details:
     ```
     '按住录音按钮开始说话',
     '首次录音 ≥5 秒自动学习你的声音',
     '识别结果自动朗读，也可复制文字',
     '在设置页可手动管理声音克隆',
     ```

5. **修改 handleNext**：最后一步跳转 `/` 而非 `/training`

6. **修改按钮文案**：'开始训练' → '开始使用'

7. **清理 imports**：移除不再使用的 `Mic`、`BookOpen`、`Volume2`

## 问题 2：VoiceClonePanel "Failed to fetch"

### 根因分析

经测试，Workers API 本身可达（CORS 正确，POST 返回 400 而非网络错误）。
可能原因：
- 浏览器环境下 WAV 转换失败时 `result.blob` 为 undefined，但 VoiceClonePanel 仍尝试发送
- 录制的 webm 在某些移动浏览器上 AudioContext.decodeAudioData 失败

### 修改方案

**文件：`src/components/VoiceClonePanel.tsx`**

1. **使用 webmBlob 作为后备**：如果 `result.blob`（WAV）不可用，使用 `result.webmBlob` 作为 fallback。Workers 端已支持处理多种音频格式。

   ```typescript
   const handleStopRecording = useCallback(async () => {
     const result = await stopRecording();
     if (result) {
       // Prefer WAV, fallback to webm if WAV conversion failed
       const blob = result.blob || result.webmBlob;
       setRecordedBlob(blob);
       setRecordedDuration(result.duration);
     }
   }, [stopRecording]);
   ```

2. **改进错误提示**：在 handleClone 中 catch 更明确的错误信息

   ```typescript
   const handleClone = useCallback(async () => {
     if (!recordedBlob) return;
     if (recordedDuration !== null && recordedDuration < 5) {
       toast.error('录音至少需要 5 秒，请重新录制');
       return;
     }
     try {
       const vid = await onClone(recordedBlob, '今天天气真不错，我想出去走走');
       if (vid) {
         toast.success('声音克隆成功！');
         setRecordedBlob(null);
         setRecordedDuration(null);
         setUploadedFileName(null);
       }
     } catch (err) {
       console.error('[VoiceClonePanel] Clone failed:', err);
       // Error is already set by useCosyVoiceTTS hook
     }
   }, [recordedBlob, recordedDuration, onClone]);
   ```

**文件：`src/hooks/useCosyVoiceTTS.ts`**

3. **改善 cloneVoice 错误信息**：当 fetch 本身抛出 TypeError 时，给出更友好的中文提示

   在 cloneVoice 的 catch 块中，检查 TypeError（"Failed to fetch"）并替换为更友好的消息：
   ```typescript
   const message = err instanceof Error
     ? (err.name === 'AbortError'
       ? '声音克隆超时，请重试'
       : err.message === 'Failed to fetch'
         ? '网络连接失败，请检查网络后重试'
         : err.message)
     : '音色复刻失败';
   ```

**文件：`workers/api/src/cosyvoice-clone.ts`**

4. **支持非 WAV 格式上传**：修改 Content-Type 检测，支持 webm/mp3 等格式直接上传到 OSS，文件名使用原始扩展名

   ```typescript
   // 根据上传文件的实际类型确定 OSS 对象键名和 Content-Type
   const mimeType = audioFile.type || 'audio/wav';
   const ext = mimeType.includes('webm') ? 'webm'
     : mimeType.includes('mp3') || mimeType.includes('mpeg') ? 'mp3'
     : 'wav';
   const objectKey = `voice-clone/${fileId}.${ext}`;
   ```

   OSS upload 时使用实际 mimeType 而非硬编码 `"audio/wav"`。

## 测试验证方案

### P0（构建健康）
- [ ] `npm run build` 退出码 = 0
- [ ] `npm run lint` 无新错误

### P1（功能验证）
- [ ] 清除 localStorage，打开应用 → 引导页显示 3 步（intro → phrases → usage）
- [ ] 引导页无"录音训练"步骤
- [ ] 最后一步按钮文案为"开始使用"
- [ ] 点击"开始使用"跳转到 `/`（使用页），不是 `/training`
- [ ] 设置页 VoiceClonePanel 录制 >5s → 点击克隆 → 不报 "Failed to fetch"
- [ ] 使用页首次录音 >5s → 自动触发声音克隆 → toast "已学习你的声音"

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/pages/WelcomePage.tsx` | 删除 training 步骤，更新文案和跳转 |
| `src/components/VoiceClonePanel.tsx` | WAV 后备 + 错误处理 |
| `src/hooks/useCosyVoiceTTS.ts` | 友好错误提示 |
| `workers/api/src/cosyvoice-clone.ts` | 支持非 WAV 格式上传 |
