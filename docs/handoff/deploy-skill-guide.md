# Cloudflare Pages 部署技能指南

> 目标读者：AI 编程助手（Claude Code、OpenClaw 等）。读完本文档后你应该能独立完成 Project Resonance 的 Cloudflare Pages 部署并验证上线状态。

---

## 目的

把 Project Resonance 前端（React SPA）和后端 API（Pages Functions）一次性部署到 Cloudflare Pages 公网，对外 URL 为 `https://project-resonance.pages.dev`。

架构说明：本项目同时使用两套后端：
- **Pages Functions**（推荐，本文档覆盖范围）：`functions/` 目录中的 `.ts` 文件，和前端同域名，无跨域问题。
- **Workers API**（`workers/api/`）：独立 Workers，通过 `VITE_API_URL` 指向。本文档不覆盖 Workers 部署。

---

## 前置条件

在开始前，确认以下条件全部满足：

```bash
# 1. Wrangler CLI 已安装
npx wrangler --version
# 期望输出: wrangler X.Y.Z

# 2. 已登录 Cloudflare 账号
npx wrangler whoami
# 期望输出: 显示账号邮箱，不是 "You are not authenticated"

# 3. Node.js 可用
node --version
# 期望输出: v18.x 或更高
```

如果 `wrangler whoami` 返回未登录，执行：
```bash
npx wrangler login
# 会打开浏览器完成 OAuth，授权后终端显示 "Successfully logged in"
```

---

## 部署流程

### Step 1: 安装依赖

```bash
cd /path/to/project-resonance  # 确保在项目根目录，不是 workers/api
npm install --legacy-peer-deps
```

验证：命令退出码为 0，无 `ERESOLVE` 错误。`--legacy-peer-deps` 是必须的，不加会因依赖冲突失败。

### Step 2: 构建前端

```bash
npx vite build
```

验证：
```bash
ls dist/index.html
# 文件存在即通过
ls dist/assets/*.js | head -1
# 至少有一个 JS 文件
```

如果构建失败，检查 `.env` 文件是否存在：
```bash
cat .env
# 应该包含:
# VITE_API_URL=
# VITE_APP_TOKEN=resonance-2026
```

如果 `.env` 不存在，创建它：
```bash
echo "VITE_API_URL=" > .env
echo "VITE_APP_TOKEN=resonance-2026" >> .env
```

**注意**：`VITE_API_URL` 必须为空（同域名模式）。如果有值，前端会请求外部 Workers，可能触发 CORS 问题。

### Step 3: 部署到 Cloudflare Pages

```bash
npx wrangler pages deploy dist --project-name project-resonance --branch main
```

参数说明：
- `dist` — 构建产物目录，wrangler 会把这里的所有文件上传
- `--project-name project-resonance` — Cloudflare Pages 项目名，必须与已有项目一致
- `--branch main` — **必须加**。加了 = 部署到 production（`project-resonance.pages.dev`）；不加 = 部署到 preview（只有独立 URL，不影响主域名）

部署日志中确认以下关键信息：
```
Compiled Worker successfully        ← functions/ 已编译
Uploading Functions bundle          ← Pages Functions 已包含
✨ Deployment complete!
https://project-resonance.pages.dev ← production URL
```

如果日志没有 "Uploading Functions bundle"，说明 `functions/` 目录没有被检测到。确认当前工作目录是项目根目录（`functions/` 和 `dist/` 同级）。

### Step 4: 部署后验证（必须执行，不可跳过）

```bash
./tests/smoke.sh
```

smoke.sh 会自动测试以下 9 项：

| ID | 检查项 | 判定标准 |
|----|--------|----------|
| S0-1 | 前端页面加载 | GET / → HTTP 200 |
| S0-2 | 页面包含应用内容 | HTML 含 "共鸣" 或 "resonance" |
| S0-3 | JS 资源可加载 | GET /assets/*.js → HTTP 200 |
| S1-1 | ASR API 响应 | POST /dashscope-asr → HTTP 200 |
| S1-2 | ASR 返回文本 | 响应含 "text" 字段 |
| S2-1 | TTS API 响应 | POST /cosyvoice-tts → HTTP 200 |
| S2-2 | TTS 返回音频 | 响应体 > 1KB |
| S3-1 | 无 Token 被拒 | POST without X-App-Token → 403 |
| S3-2 | CORS 预检 | OPTIONS → 204 |

退出码 0 = 全部通过。退出码 1 = 有失败，查看 [FAIL] 行定位问题。

也可以手动逐项验证（smoke.sh 不可用时）：
```bash
BASE="https://project-resonance.pages.dev"
TOKEN="resonance-2026"

# S0-1: 前端加载
curl -s -o /dev/null -w "%{http_code}" "$BASE/"
# 期望: 200

# S0-2: 页面包含应用内容
curl -s "$BASE/" | grep -c "共鸣\|resonance"
# 期望: > 0

# S1-1 + S1-2: ASR API
python3 -c "
import wave
f = wave.open('/tmp/test.wav','w'); f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000)
f.writeframes(b'\x00\x00'*16000); f.close()
"
curl -s "$BASE/dashscope-asr" -X POST \
  -H "X-App-Token: $TOKEN" \
  -F "file=@/tmp/test.wav;type=audio/wav"
# 期望: {"text":"..."}

# S2-1 + S2-2: TTS API
curl -s -o /tmp/test.mp3 "$BASE/cosyvoice-tts" \
  -X POST -H "X-App-Token: $TOKEN" \
  -H "Content-Type: application/json" -d '{"text":"你好"}'
wc -c < /tmp/test.mp3
# 期望: > 1024

# S3-1: 无 Token 被拒
curl -s -o /dev/null -w "%{http_code}" "$BASE/dashscope-asr" -X POST
# 期望: 403

# S3-2: CORS 预检
curl -s -o /dev/null -w "%{http_code}" "$BASE/dashscope-asr" -X OPTIONS \
  -H "Origin: https://project-resonance.pages.dev"
# 期望: 204
```

**smoke test 全部通过后，才能把 URL 给用户。**

---

## Secrets 管理

Pages Functions 使用的 secrets 已经在 Cloudflare 后台配置好，正常部署时**不需要重新设置**。

以下是完整的 secrets 列表（供参考和新项目初始化用）：

| Secret 名称 | 用途 |
|-------------|------|
| `DASHSCOPE_API_KEY` | DashScope ASR / TTS / Voice Clone 鉴权 |
| `OSS_BUCKET` | 阿里云 OSS 存储桶名（Voice Clone 音频存储） |
| `OSS_ENDPOINT` | 阿里云 OSS 访问端点 |
| `OSS_ACCESS_KEY_ID` | OSS 访问密钥 ID |
| `OSS_ACCESS_KEY_SECRET` | OSS 访问密钥 Secret |
| `WORKER_AUTH_SECRET` | 前端 X-App-Token 的验证值（目前为 `resonance-2026`） |

如果需要在新项目重新设置：
```bash
echo "YOUR_KEY_VALUE" | npx wrangler pages secret put DASHSCOPE_API_KEY --project-name project-resonance
echo "YOUR_KEY_VALUE" | npx wrangler pages secret put OSS_BUCKET --project-name project-resonance
echo "YOUR_KEY_VALUE" | npx wrangler pages secret put OSS_ENDPOINT --project-name project-resonance
echo "YOUR_KEY_VALUE" | npx wrangler pages secret put OSS_ACCESS_KEY_ID --project-name project-resonance
echo "YOUR_KEY_VALUE" | npx wrangler pages secret put OSS_ACCESS_KEY_SECRET --project-name project-resonance
echo "resonance-2026" | npx wrangler pages secret put WORKER_AUTH_SECRET --project-name project-resonance
```

**重要**：设置 secrets 后必须重新运行 `npx wrangler pages deploy` 才能生效。secrets 不会自动应用到已有部署。

验证 secrets 是否已配置（不显示值，只显示名称）：
```bash
npx wrangler pages secret list --project-name project-resonance
```

---

## Pages Functions 架构

`functions/` 目录中的文件会被 wrangler 自动编译为 Cloudflare Workers，和前端同域名运行。

```
functions/
├── _middleware.ts           # 全局中间件：auth + CORS
├── dashscope-asr.ts         # POST /dashscope-asr — 语音识别
├── cosyvoice-tts.ts         # POST /cosyvoice-tts — 语音合成
└── cosyvoice-voice-clone.ts # POST /cosyvoice-voice-clone — 声音克隆
```

### _middleware.ts 行为

中间件只对 API 路径生效（`/dashscope-asr`、`/cosyvoice-tts`、`/cosyvoice-voice-clone`），静态资源（HTML/CSS/JS）直接放行，不做 auth 检查。

auth 逻辑：请求头 `X-App-Token` 必须与 `WORKER_AUTH_SECRET` 环境变量一致，否则返回 403。

```
请求 /
→ _middleware: 不是 API 路径，直接 next()
→ Pages 静态资源服务，返回 index.html

请求 /dashscope-asr (带 X-App-Token)
→ _middleware: 是 API 路径 → 验证 Token → 通过 → next()
→ dashscope-asr.ts 处理
→ _middleware 把 CORS headers 加到响应上

请求 /dashscope-asr (无 Token)
→ _middleware: 是 API 路径 → 验证 Token → 失败 → 返回 403
→ dashscope-asr.ts 不执行
```

### dashscope-asr.ts

接受 `multipart/form-data`，`file` 字段为音频文件（WAV/MP3/MP4/OGG/FLAC/WebM），最大 5MB。内部把音频转为 base64 data URI，调用 DashScope `qwen3-asr-flash` 模型，返回 `{"text": "识别结果"}` 。

### cosyvoice-tts.ts

接受 JSON `{"text": "要合成的文字"}`，可选 `voice_id` 字段（声音克隆后的音色 ID）。内部用 Cloudflare Workers 的 `connect()` API 做手动 WebSocket 握手（因为 `fetch()` 的 WebSocket upgrade 会 strip Authorization header），返回 MP3 音频流。

### cosyvoice-voice-clone.ts

接受 `multipart/form-data`，`file` 字段为参考音频（建议 5 秒以上含语音内容的 WAV）。内部先把音频上传到 OSS，再调用 DashScope Voice Clone REST API，返回 `{"voice_id": "..."}` 供后续 TTS 使用。

---

## 常见错误和解决方案

| 现象 | 原因 | 解决 |
|------|------|------|
| S0-1 失败，前端返回 403 | `_middleware.ts` 把静态资源也拦截了 | 检查 `_middleware.ts` 的 `API_PATHS` 列表，确保只有 API 路径，不含 `/` |
| S0-3 失败，JS 资源 403 | 同上 | 同上 |
| S1-1 / S2-1 失败，API 返回 405 | 部署到了 preview 而不是 production | 在 deploy 命令加 `--branch main` 重新部署 |
| API 返回 `{"error":"Forbidden"}` | Token 不对或没传 | 确认请求头 `X-App-Token: resonance-2026`；确认 `WORKER_AUTH_SECRET` secret 已设置 |
| API 返回 `invalid_api_key` 或 401 | `DASHSCOPE_API_KEY` secret 没设或没重新部署 | 设置 secret 后重新 `wrangler pages deploy` |
| S2-2 失败，TTS 响应 < 1KB | TTS 后端出错返回了 JSON 错误信息 | `curl "$BASE/cosyvoice-tts" -X POST -H "X-App-Token: resonance-2026" -H "Content-Type: application/json" -d '{"text":"你好"}' -v` 查看实际响应 |
| 国内用户 "Failed to fetch" | 前端请求了 `workers.dev` 域名（被墙） | 确认 `.env` 中 `VITE_API_URL=`（空值），重新构建部署 |
| 部署时 wrangler 网络错误 | 网络波动 | 直接重试 `npx wrangler pages deploy ...` |
| `npm install` 失败，ERESOLVE | 依赖版本冲突 | 必须加 `--legacy-peer-deps` |
| "Compiled Worker successfully" 但 "No Functions bundle" | `functions/` 不在当前目录 | 确认 `pwd` 是项目根目录（含 `functions/` 和 `dist/` 的那一级） |
| smoke.sh 报 "python3: command not found" | 系统无 python3 | 手动创建测试 WAV：`ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 1 /tmp/test.wav` |

---

## 给 AI Agent 的行为规则

在帮用户执行部署时，必须遵守以下规则：

1. **部署后必须跑 smoke test，全部通过后才能把 URL 给用户。** 不要在 wrangler 部署成功后就说"部署完成，URL 是 xxx"——先跑 `./tests/smoke.sh`，退出码 0 才算真正完成。

2. **先测 localhost 再部署线上。** 如果用户修改了代码，先用 `npx vite preview --port 8080` 在本地验证，通过后再部署。

3. **不要把 API Key 写进 `.env` 或前端代码。** `DASHSCOPE_API_KEY` 等只能存在 Cloudflare Pages secrets 里，通过 `wrangler pages secret put` 设置。前端代码里出现 API Key = 严重安全问题，立即停止并报告。

4. **部署命令必须带 `--branch main` 才是 production。** 不加参数或加其他 branch 名会部署到 preview，preview URL 不稳定且不是用户期望的主域名。

5. **如果 smoke test 失败，先排查再重试，不要盲目重新部署。** 步骤：读 [FAIL] 行 → 用手动 curl 复现 → 分析是代码问题还是配置问题 → 修复 → 重新部署 → 重跑 smoke test。

6. **单项失败超过 5 次则停止，报告所有尝试给用户。** 不要无限重试。

7. **改 `_middleware.ts` 后重点验证 S0-1 和 S0-3。** 中间件最容易误伤静态资源，每次改完必须确认前端页面和 JS 资源还能正常加载。

---

## 测试体系（完整）

本项目有三层测试，部署场景只需 Layer 0：

| 层级 | 脚本 | 何时用 | 耗时 |
|------|------|--------|------|
| Layer 0: Smoke | `./tests/smoke.sh` | 每次部署后 | ~30s |
| Layer 1: 功能回归 | `python tests/regression.py` | 改代码后 | ~2min |
| Layer 2: 全量 | Layer 0 + Layer 1 + 手动 | 发版前 | ~5min |

Layer 1 需要先安装 Playwright：
```bash
pip install playwright
playwright install chromium
python tests/regression.py                                         # 测 localhost
python tests/regression.py https://project-resonance.pages.dev    # 测线上
```

---

## 快速参考

```bash
# 完整部署流程（一键执行）
npm install --legacy-peer-deps && \
npx vite build && \
npx wrangler pages deploy dist --project-name project-resonance --branch main && \
./tests/smoke.sh

# 只重新部署（代码无变化，只是想刷新）
npx wrangler pages deploy dist --project-name project-resonance --branch main

# 检查当前 secrets
npx wrangler pages secret list --project-name project-resonance

# 查看最近部署记录
npx wrangler pages deployment list --project-name project-resonance
```
