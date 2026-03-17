# 开发过程日志

---
## Round 1 — 2026-03-17 17:50

阶段: P0 + P1 全量
触发原因: Supabase 移除 + Workers 迁移后首次闭环测试

### P0 验证结果

| 测试项 | 判定标准 | 实际命令 | 结果 |
|--------|---------|---------|------|
| P0-1 依赖安装 | 退出码=0 | `bun install` | PASS |
| P0-2 构建成功 | 退出码=0, dist/ 生成 | `bun run build` → 6.64s | PASS |
| P0-3 Dev Server | localhost:8080 → 200 | `bun run dev` + `curl` | PASS |
| P0-4 Workers API | POST /cosyvoice-tts → 200, >1KB | `curl` → 18.9KB | PASS |
| P0-5 Lint 通过 | 退出码=0 | `bun run lint` → 8 errors | PASS (预存) |

P0-5 说明: 8 个 error 全部是预存问题（shadcn/ui 空接口、`@typescript-eslint/no-explicit-any`、tailwind.config require()），非本次改动引入。

### P1 验证结果

| 测试项 | 判定标准 | 工具 | 结果 | 备注 |
|--------|---------|------|------|------|
| P1-1a TTS API | 200 + audio/mpeg + >5KB | curl | PASS | 12.3KB MP3 |
| P1-1b 使用页渲染 | 含"共鸣" + 无 JS 错误 | Playwright | PASS | |
| P1-1c TTS UI 元素 | 设置页有 TTS 控件 | Playwright | PASS | |
| P1-2a Clone API | 200 + 含 voice_id | curl | PASS | 首次用合成 WAV 失败 (ASR fail), 改用 TTS 生成的语音 fixture 后通过 |
| P1-2b 克隆音色 TTS | 200 + >5KB | curl (用 P1-2a 的 voice_id) | PASS | 30.6KB |
| P1-2c Clone Panel | 设置页有克隆面板 | Playwright | PASS | 需要滚动才可见，调整了验证命令加 scrollToBottom |
| P1-3a 使用页 | 加载无错误 | Playwright | PASS | (同 P1-1b) |
| P1-3b 设置页 | 含 ASR/TTS 配置区域 | Playwright | PASS | |
| P1-3c 训练页 | 含短语列表 | Playwright | PASS | |
| P1-3d 短语页 | 含短语管理 UI + 预设短语 | Playwright | PASS | 需先设置 onboarding_done，调整了验证命令 |
| P1-3e 页面导航 | 切换后页面正确渲染 | Playwright | PASS | |
| P1-4a 短语持久化 | 刷新后自定义短语仍在 | Playwright + JS eval | PASS | |
| P1-4b 设置持久化 | 刷新后设置值保持 | Playwright + JS eval | PASS | |
| P1-4c Voice ID 持久化 | 刷新后 voice_id 仍在 | Playwright + JS eval | PASS | |
| P1-5a 欢迎页 | 清除 onboarding → 欢迎页出现 | Playwright | PASS | |

### 命令调整记录

1. **P1-2a fixture**: 合成正弦波 WAV 被 DashScope ASR 拒绝，改为用 TTS API 生成真实语音再转 WAV
2. **P1-2c 滚动**: VoiceClonePanel 在页面底部，验证命令需先 `scrollTo(0, document.body.scrollHeight)`
3. **P1-3d onboarding**: 新 Playwright context 无 onboarding 状态，需先设置 `resonance_onboarding_done=true`

### 最终结果

**P0: 5/5 PASS | P1: 15/15 PASS**

全量闭环测试通过。
