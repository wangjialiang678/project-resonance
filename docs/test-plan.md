# Project Resonance 闭环测试方案

生成时间: 2026-03-17
项目状态: Supabase → Cloudflare Workers 迁移完成，auth 层移除
前端验证工具: Playwright (Python)

---

## P0: 基础健康检查

- [ ] **P0-1: 依赖安装**
  判定标准: `bun install` 退出码=0，无 error
  建议命令: `cd project-root && bun install`

- [ ] **P0-2: 构建成功**
  判定标准: `bun run build` 退出码=0，`dist/` 目录生成
  建议命令: `bun run build`

- [ ] **P0-3: Dev Server 启动**
  判定标准: `http://localhost:8080` 返回 HTTP 200
  建议命令: `bun run dev &` → `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080`

- [ ] **P0-4: Workers API 可达**
  判定标准: `POST /cosyvoice-tts` 返回 HTTP 200 + 音频数据 >1KB
  建议命令: `curl -s -X POST $API_URL/cosyvoice-tts -H "Content-Type: application/json" -d '{"text":"你好"}' -o /tmp/test.mp3 && ls -la /tmp/test.mp3`

- [ ] **P0-5: Lint 通过**
  判定标准: `bun run lint` 退出码=0
  建议命令: `bun run lint`

---

## P1: 核心功能验证

### 功能 1: TTS 播报完整链路

- [ ] **P1-1a [后端]** TTS API 返回有效音频
  判定标准: POST /cosyvoice-tts `{"text":"今天天气真不错"}` → HTTP 200, Content-Type=audio/mpeg, body >5KB
  建议命令: curl + 检查 response headers 和 body size

- [ ] **P1-1b [前端]** 页面加载 → 使用页正常渲染
  判定标准: 访问 `http://localhost:8080` → 页面包含"共鸣"标题文字，无 JS 错误
  建议工具: Playwright → navigate → 检查页面内容 + console errors

- [ ] **P1-1c [端到端]** TTS 按钮触发播报
  判定标准: 设置页面有 TTS 相关控件可见，TTS API 网络请求成功发出
  建议工具: Playwright → 导航到设置页 → 检查 TTS 相关 UI 元素存在

### 功能 2: Voice Clone 链路

- [ ] **P1-2a [后端]** Clone API 接受音频上传
  判定标准: POST /cosyvoice-voice-clone (FormData with WAV) → HTTP 200, 返回 JSON 含 voice_id
  建议命令: curl -F "audio=@fixtures/test-5s.wav" $API_URL/cosyvoice-voice-clone

- [ ] **P1-2b [后端]** Clone 后的 voice_id 可用于 TTS
  判定标准: POST /cosyvoice-tts `{"text":"测试","voice":"<cloned_id>"}` → HTTP 200, 音频 >5KB
  建议命令: curl (用 P1-2a 返回的 voice_id)

- [ ] **P1-2c [前端]** VoiceClonePanel UI 可见且可交互
  判定标准: 设置页 → 声音克隆面板可见，包含录音/上传按钮
  建议工具: Playwright → navigate /settings → 查找克隆面板元素

### 功能 3: 四页面导航与渲染

- [ ] **P1-3a [前端]** 使用页 (/) 正常渲染
  判定标准: 页面加载无 JS 错误，包含录音相关 UI 元素
  建议工具: Playwright

- [ ] **P1-3b [前端]** 设置页 (/settings) 正常渲染
  判定标准: 页面包含"设置"相关文字，ASR/TTS 配置区域可见
  建议工具: Playwright

- [ ] **P1-3c [前端]** 训练页 (/training) 正常渲染
  判定标准: 页面包含短语列表，训练进度可见
  建议工具: Playwright

- [ ] **P1-3d [前端]** 短语页 (/phrases) 正常渲染
  判定标准: 页面包含短语管理 UI，预设短语已加载
  建议工具: Playwright

- [ ] **P1-3e [前端]** 页面间导航正常
  判定标准: 从使用页 → 设置页 → 使用页，每次切换后页面正确渲染
  建议工具: Playwright → click nav tabs → verify content

### 功能 4: localStorage 离线数据持久化

- [ ] **P1-4a [前端]** 短语数据持久化
  判定标准: 添加自定义短语 → 刷新页面 → 自定义短语仍存在（检查 localStorage key `resonance_phrases`）
  建议工具: Playwright → evaluate JS → add phrase → reload → verify

- [ ] **P1-4b [前端]** 设置数据持久化
  判定标准: 修改设置 → 刷新页面 → 设置值保持（检查 localStorage key `resonance_settings`）
  建议工具: Playwright → evaluate JS → change setting → reload → verify

- [ ] **P1-4c [前端]** Voice ID 持久化
  判定标准: localStorage `resonance_cosyvoice_voice_id` 写入后，刷新页面仍存在
  建议工具: Playwright → evaluate JS

### 功能 5: 首次引导流程

- [ ] **P1-5a [前端]** 清空 onboarding 状态后显示欢迎页
  判定标准: 删除 `resonance_onboarding_done` → 刷新 → 欢迎页出现
  建议工具: Playwright → clear localStorage → reload → check welcome content

---

## 手动测试（硬件依赖，不纳入自动化）

- [ ] **M1** 麦克风录音 → ASR 识别 → 文字结果
  原因: 需要真实麦克风输入
  注: 后端 ASR 链路为 StepFun 直连，由用户 API Key 驱动

- [ ] **M2** 录音 → 自动触发 Voice Clone → 克隆音色 TTS
  原因: 需要真实麦克风 + 5秒以上语音

---

## 测试 Fixture

| 文件 | 用途 | 规格 |
|------|------|------|
| `fixtures/test-5s.wav` | Voice Clone 测试 | 16kHz mono WAV, ~5秒, 含语音 |
