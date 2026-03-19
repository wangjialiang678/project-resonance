# dev-workflow-setup.md

帮你和你的 AI 助手快速上手 Project Resonance 开发，搭建与项目负责人相同的工作流。

---

## 1. 环境准备

### 必装工具

| 工具 | 版本要求 | 安装方式 |
|------|----------|----------|
| Node.js | 18+ | 推荐 [nvm](https://github.com/nvm-sh/nvm) |
| Python | 3.10+ | 系统自带或 pyenv |
| Wrangler CLI | v4 | `npm install -g wrangler` |
| Git | 任意 | 系统自带 |

### 可选但推荐

- **Claude Code CLI**：AI 辅助开发，读 `CLAUDE.md` 获得完整上下文
- **Playwright**：前端功能回归测试（Layer 1）
  ```bash
  pip install playwright && playwright install chromium
  ```

### 克隆仓库

```bash
git clone https://github.com/wangjialiang678/project-resonance.git
cd project-resonance
npm install --legacy-peer-deps
```

`--legacy-peer-deps` 是必须的，不加会报依赖冲突错误。

---

## 2. 环境变量

根目录 `.env` 文件内容（已有默认值，无需改动）：

```bash
# API 后端地址。空 = 同域名 Pages Functions（生产/本地均可）
# 本地调试独立 Workers 时改为: http://localhost:8787
VITE_API_URL=

# 前端鉴权 token，与 Cloudflare 服务端 WORKER_AUTH_SECRET 一致
VITE_APP_TOKEN=resonance-2026
```

**重要**：API Key（DashScope、OSS）全部在服务端（Cloudflare Pages secrets），前端代码里没有、也不需要有。不要把任何 API Key 写进前端代码。

---

## 3. 项目架构速览

```
浏览器 / 小程序
    │
    ├── 前端请求 /dashscope-asr
    ├── 前端请求 /cosyvoice-tts         ← 同域名，无跨域问题
    └── 前端请求 /cosyvoice-voice-clone
           │
           ▼
  Cloudflare Pages Functions (functions/)
  ├── _middleware.ts    ← X-App-Token 鉴权 + CORS，所有 API 路由共用
  ├── dashscope-asr.ts  ← DashScope qwen3-asr-flash
  ├── cosyvoice-tts.ts  ← CosyVoice TTS
  └── cosyvoice-voice-clone.ts ← 声音克隆（OSS 中转）
           │
           ▼
  DashScope API（ASR / TTS / Voice Clone）
  阿里云 OSS（声音克隆临时文件）
```

### 关键目录

```
src/              # React 前端
  hooks/          # useDashscopeASR, useCosyVoiceTTS, useAppData ...
  pages/          # UsagePage, SettingsPage, TrainingPage, PhrasesPage
  components/     # UI 组件
functions/        # Pages Functions API（主力后端，随前端一起部署）
workers/api/      # 独立 Workers 版 API（备用，目前不需要单独部署）
tests/            # smoke.sh + regression.py
```

### 数据存储

全部 localStorage，无数据库：

| key | 内容 |
|-----|------|
| `resonance_phrases` | 用户短语列表 |
| `resonance_settings` | ASR/TTS 设置 |
| `resonance_recordings` | 录音 blob（data URL 序列化） |
| `resonance_cosyvoice_voice_id` | 克隆音色 ID |

---

## 4. 本地开发

### 启动前端

```bash
npm run dev   # Vite dev server，http://localhost:8080
```

前端直接访问 `http://localhost:8080` 即可，API 请求会走线上 Pages Functions（`VITE_API_URL` 为空时自动同域名）。

本地前端 + 线上 API 的组合在开发中完全够用，不需要在本地跑 API。

### 本地调试 API（可选）

仅当你需要改 `functions/` 代码并在本地验证时：

```bash
# 终端 1：启动前端
npm run dev

# 终端 2：启动 Pages Functions 本地模拟
npx wrangler pages dev dist --port 8788
# 注意：需要先 npm run build，或改用 --proxy 8080 代理前端
```

也可以用独立的 Workers 调试：

```bash
cd workers/api
npx wrangler@4 dev   # 监听 http://localhost:8787
# 同时修改 .env: VITE_API_URL=http://localhost:8787
```

`WORKER_AUTH_SECRET` 未配置时，Workers 本地鉴权会静默跳过，方便本地测试。

---

## 5. 测试

详细测试方案见 `docs/test-plan.md`。

### Layer 0: Smoke Test（部署后必跑）

```bash
./tests/smoke.sh                            # 测线上（project-resonance.pages.dev）
./tests/smoke.sh http://localhost:8080      # 测本地
```

耗时约 30 秒，验证前端加载、ASR/TTS API 可用、无 Token 被拒、CORS 预检。

### Layer 1: 功能回归（改代码后跑）

```bash
python tests/regression.py                                       # 测 localhost
python tests/regression.py https://project-resonance.pages.dev  # 测线上
```

耗时约 2 分钟，需要先安装 Playwright（见上方环境准备）。

### 什么时候跑什么

| 操作 | 测试 |
|------|------|
| 改了 `src/`（前端代码） | Layer 1（localhost） |
| 改了 `functions/`（API） | 部署后跑 Layer 0 + Layer 1 |
| 每完成 3 个功能改动 | 重跑 Layer 1 全部（回归） |
| 任何部署后 | Layer 0（硬门槛，不过不给用户 URL） |

---

## 6. 部署

### 前端 + API 一起部署（常规操作）

```bash
npx vite build
npx wrangler pages deploy dist --project-name project-resonance --branch main
```

两条命令，按顺序执行。

**注意事项：**

- `--branch main` 部署到 production（`project-resonance.pages.dev`）
- 不加 `--branch main` 会部署到 preview URL（随机子域名），不影响线上
- Cloudflare Dashboard 里的 secrets 已配好，不需要每次设置
- **部署后必须跑 `./tests/smoke.sh`**，通过后才算部署完成
- 免费版每月 500 次构建额度

### 查看部署日志

```bash
npx wrangler pages deployment tail --project-name project-resonance
```

### Workers API 独立部署（通常不需要）

`functions/` 目录下的 Pages Functions 已经覆盖所有 API 功能，`workers/api/` 是迁移前的备份，一般不需要单独部署。

如果需要（例如调试 Workers 特定行为）：

```bash
cd workers/api
export DASHSCOPE_API_KEY=xxx
export OSS_ACCESS_KEY_ID=xxx
export OSS_ACCESS_KEY_SECRET=xxx
export OSS_BUCKET=xxx
export OSS_ENDPOINT=xxx
export WORKER_AUTH_SECRET=resonance-2026

npx wrangler@4 deploy \
  --var DASHSCOPE_API_KEY:$DASHSCOPE_API_KEY \
  --var OSS_ACCESS_KEY_ID:$OSS_ACCESS_KEY_ID \
  --var OSS_ACCESS_KEY_SECRET:$OSS_ACCESS_KEY_SECRET \
  --var OSS_BUCKET:$OSS_BUCKET \
  --var OSS_ENDPOINT:$OSS_ENDPOINT \
  --var WORKER_AUTH_SECRET:$WORKER_AUTH_SECRET
```

wrangler v4 的 secrets 不累积：`secret put` 和 `deploy` 是独立版本，**必须在 `deploy` 时用 `--var` 一次性传入所有变量**，否则环境变量会丢失。

---

## 7. 常见问题

**Q: npm install 报错**
A: 加 `--legacy-peer-deps`，这个项目有依赖版本冲突，是已知问题。

**Q: 部署后页面打不开或 API 报错**
A: 检查是否加了 `--branch main`。不加的话部署到 preview URL，访问的还是旧的 production。

**Q: 国内访问慢或 API 超时**
A: API 走 Pages Functions（同域名），和前端在同一个 Cloudflare 节点，不会有跨域问题。如果仍然超时，通常是 DashScope 上游延迟，不是部署问题。

**Q: ASR/TTS 返回 403**
A: `X-App-Token` 不对。确认 `.env` 中 `VITE_APP_TOKEN` 的值与 Cloudflare Dashboard 里 `WORKER_AUTH_SECRET` secret 一致。

**Q: 声音克隆后换设备音色丢了**
A: 已知限制。`voice_id` 只存 localStorage，换设备/清浏览器数据需要重新克隆。

**Q: 怎么看 API 报错详情**
A: 打开 Chrome DevTools → Network，看 `/dashscope-asr` 或 `/cosyvoice-tts` 的响应体，JSON 里有错误信息。或者用 wrangler 查日志：
```bash
npx wrangler pages deployment tail --project-name project-resonance
```

---

## 8. 给 AI 助手的说明

如果你是 Claude Code、Cursor 或其他 AI 编程助手，请注意：

- **先读 `CLAUDE.md`**，获取完整项目上下文（技术栈、架构、部署方式、开发纪律）
- **改代码后先测试，再部署**：
  - 改前端代码 → `python tests/regression.py`
  - 改 `functions/` → 部署后跑 `./tests/smoke.sh`
- **`functions/` 是主力 API**，不是 `workers/api/`。改 API 逻辑改 `functions/`，改完随前端一起部署
- **不要把 API Key 写进前端代码**，所有密钥在 Cloudflare 服务端
- **`VITE_API_URL` 留空是正确的**，空 = 同域名 Pages Functions，不需要改
- **部署命令是两步**：`npx vite build` 然后 `npx wrangler pages deploy dist --project-name project-resonance --branch main`
- 架构迁移背景见 `docs/handoff/architecture-migration.md`
