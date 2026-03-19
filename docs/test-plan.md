# Project Resonance 测试方案

更新: 2026-03-19
架构: Cloudflare Pages + Pages Functions (同域名)
前端验证: Playwright (Python) + curl

---

## 三层测试体系

| 层级 | 名称 | 何时跑 | 耗时 | 脚本 |
|------|------|--------|------|------|
| **Layer 0** | Smoke Test | **每次部署后必跑** | ~30s | `tests/smoke.sh` |
| **Layer 1** | 功能回归 | 每次改代码后跑 | ~2min | `tests/regression.py` |
| **Layer 2** | 全量验证 | 发版/大改前跑 | ~5min | Layer 0 + Layer 1 + 手动 |

### 规则

- **Layer 0 是硬门槛**：部署后 smoke test 不过，不给用户 URL
- **Layer 1 测 localhost 和线上**：改完代码先跑 localhost，部署后再跑线上
- **每完成 3 个改动后**：重跑 Layer 1 全部（回归检查）

---

## Layer 0: Smoke Test

`tests/smoke.sh [URL]`

默认测 https://project-resonance.pages.dev ，也可传入 localhost 或 preview URL。

| ID | 检查项 | 判定标准 |
|----|--------|----------|
| S0-1 | 前端页面加载 | GET / → HTTP 200 |
| S0-2 | 页面包含应用内容 | HTML 含 "共鸣" 或 "语音识别" |
| S0-3 | JS 资源可加载 | GET /assets/*.js → HTTP 200 |
| S1-1 | ASR API 响应 | POST /dashscope-asr → HTTP 200 |
| S1-2 | ASR 返回文本 | 响应含 "text" 字段 |
| S2-1 | TTS API 响应 | POST /cosyvoice-tts → HTTP 200 |
| S2-2 | TTS 返回音频 | 响应体 > 1KB |
| S3-1 | 无 Token 被拒 | POST without X-App-Token → 403 |
| S3-2 | CORS 预检 | OPTIONS → 204 |

---

## Layer 1: 功能回归

`python tests/regression.py [URL]`

默认测 http://localhost:8080 ，也可传入线上 URL。

| ID | 检查项 | 判定标准 | 类型 |
|----|--------|----------|------|
| **R1 前端加载** | | | |
| R1-1 | 前端返回 200 | Playwright navigate → 200 | 前端 |
| R1-2 | 页面有应用内容 | body 包含 "共鸣" / "语音识别" / "欢迎" | 前端 |
| R1-3 | 无 JS console error | console error 计数 = 0 | 前端 |
| **R2 页面导航** | | | |
| R2-1 | 使用页 (/) | 包含 "语音识别" 或 "录音" | 前端 |
| R2-2 | 设置页 (/settings) | 包含 "设置" 或 "声音" | 前端 |
| R2-3 | 训练页 (/training) | 包含 "训练" 或 "短语" | 前端 |
| R2-4 | 短语页 (/phrases) | 包含 "短语" 或 "管理" | 前端 |
| R2-5 | 页面间导航 | / → /settings 正常切换 | 前端 |
| **R3 引导页** | | | |
| R3-1 | 显示欢迎页 | 清空 onboarding → 出现 "欢迎" | 前端 |
| R3-2 | 无训练步骤 | 不含 "录音训练" | 前端 |
| R3-3 | 最后按钮 | 第3步显示 "开始使用" | 前端 |
| R3-4 | 完成后导航 | 点击后跳转到 / | 前端 |
| **R4 数据持久化** | | | |
| R4-1 | 短语持久化 | 写入 → 刷新 → 仍存在 | 前端 |
| R4-2 | Voice ID 持久化 | 写入 → 刷新 → 仍存在 | 前端 |
| **R5 API 健康** | | | |
| R5-1 | ASR API 200 | POST /dashscope-asr → 200 | 后端 |
| R5-2 | ASR 返回 text | 响应含 text 字段 | 后端 |
| R5-3 | TTS API 200 | POST /cosyvoice-tts → 200 | 后端 |
| R5-4 | TTS 返回音频 | 响应 > 1KB | 后端 |
| **R6 Auth & 安全** | | | |
| R6-1 | 无 Token 被拒 | 403 | 后端 |
| R6-2 | 无 StepFun 引用 | 设置页无 "阶跃" / "stepfun" | 前端 |
| R6-3 | 无 API Key 泄漏 | dist/ 中无 STEPFUN_API_KEY | 安全 |

---

## Layer 2: 全量验证（发版前）

在 Layer 0 + Layer 1 基础上，额外执行：

### 手动测试（硬件依赖）

| ID | 检查项 | 方法 |
|----|--------|------|
| M1 | 麦克风录音 → ASR → 文字 | 真机浏览器录音 |
| M2 | 录音 ≥5s → 自动 Voice Clone | 首次使用流程 |
| M3 | Clone 后 TTS 播报 | 使用克隆音色 |

### 跨设备验证

| ID | 环境 | 检查 |
|----|------|------|
| D1 | Chrome 桌面 | 全流程 |
| D2 | Android 手机浏览器 | 录音 + ASR |
| D3 | iOS Safari | 录音 + ASR |
| D4 | 微信内置浏览器 | 页面加载 + 基本交互 |

---

## 常用命令

```bash
# Layer 0: 部署后 smoke test
./tests/smoke.sh                                          # 测线上
./tests/smoke.sh http://localhost:8080                    # 测本地

# Layer 1: 功能回归（需要先 pip install playwright && playwright install chromium）
python tests/regression.py                                 # 测 localhost
python tests/regression.py https://project-resonance.pages.dev  # 测线上

# P0: 构建检查
npm install --legacy-peer-deps && npx vite build && npx vite preview --port 8080
```

---

## 失败处理（同 CLAUDE.md 闭环规则）

| 条件 | 响应 |
|------|------|
| 单项失败 ≥ 5 次 | 停止该项，报告所有尝试 |
| 振荡（修 A 破 B ≥ 2 次） | 停止，报告架构问题 |
| 总修复次数 ≥ 15 次 | 停止，生成完整失败报告 |

## 测试 Fixture

| 文件 | 用途 | 规格 |
|------|------|------|
| `fixtures/test-5s.wav` | Voice Clone 测试 | 16kHz mono WAV, ~5秒, 含语音 |
| (自动生成) | ASR smoke test | 1秒静音 WAV, 由脚本生成 |
