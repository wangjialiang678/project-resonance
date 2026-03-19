# 调研报告: Cloudflare Pages Functions 部署机制

**日期**: 2026-03-19
**任务**: 搞清楚 `wrangler pages deploy` 时 `functions/` 目录的查找逻辑、TypeScript 命名约定、中间件格式、兼容性标志、以及 secrets 生效时机

---

## 调研摘要

`wrangler pages deploy <dir>` 中的 `<dir>` 只是静态文件目录，`functions/` 目录的查找**始终相对于 CWD（当前工作目录）**，与 `<dir>` 参数无关。因此从项目根目录运行 `wrangler pages deploy dist`，wrangler 会查找 `./functions/`（即项目根目录下的 functions），而非 `dist/functions/`。部署日志显示 "Compiled Worker successfully" 并不能证明 functions 内容正确被纳入——只要 CWD 下有 `functions/` 目录（哪怕是空目录），就会触发编译。405 的根本原因几乎必然是 functions 目录被找到但内容不对，或者实际访问路径与函数文件路径不匹配。

**注意**：本项目架构实际是 Cloudflare Workers（`workers/api/`），不是 Pages Functions（`functions/`）。下面的调研结论针对"假如要用 Pages Functions"的场景，以及说明当前 Workers 方案为何是正确选择。

---

## 1. functions/ 目录的查找路径

### 结论：相对于 CWD，不是相对于 `<dir>`

官方文档和社区大量讨论一致确认：

```
wrangler pages deploy dist --project-name project-resonance
```

这条命令中：
- `dist` → 静态文件目录（HTML/CSS/JS 等）
- `functions/` → **从 CWD 查找**，即 `./functions/`

正确的项目结构：
```
project-root/          ← 必须从这里执行 wrangler 命令
├── functions/         ← wrangler 在此查找 Functions
│   ├── _middleware.ts
│   └── dashscope-asr.ts
└── dist/              ← Vite 构建输出，作为 <dir> 参数
```

**错误的假设**：
```
dist/
└── functions/   ← 这里的 functions 不会被识别
```

### 没有 `--functions` 参数

`wrangler pages deploy` 命令**没有** `--functions-directory` 或 `--functions` 参数。社区早在 2022 年就提出了这个 feature request（Issue #3064），但截至 2025 年仍未实现，因为文件路径基于 Pages Dashboard 的 CI/CD 也需要同步支持。

完整的 `wrangler pages deploy` 参数列表：
```
npx wrangler pages deploy [DIRECTORY]
  --project-name    项目名
  --branch          分支名
  --commit-hash     commit SHA
  --commit-message  commit 消息
  --commit-dirty    是否标记为 dirty
  --skip-caching    跳过 asset 缓存
  --no-bundle       不打包 _worker.js（advanced mode 用）
  --upload-source-maps  上传 sourcemaps（默认 false）
```

### 两阶段部署方案（显式编译）

也可以先显式编译 functions，再部署：
```bash
# Step 1: 编译 functions 目录 → 生成 _worker.bundle
npx wrangler pages functions build ./functions --outfile dist/_worker.bundle

# Step 2: 部署（此时 dist/_worker.bundle 会被作为 worker 使用）
npx wrangler pages deploy dist --project-name project-resonance
```

---

## 2. TypeScript 文件命名和导出约定

### 文件命名 = 路由路径

Pages Functions 使用**基于文件路径的路由**：

| 文件路径 | 对应路由 |
|----------|----------|
| `functions/index.ts` | `/` |
| `functions/dashscope-asr.ts` | `/dashscope-asr` |
| `functions/api/transcribe.ts` | `/api/transcribe` |
| `functions/[[path]].ts` | 所有路由（catch-all） |

### 导出约定

```typescript
// 处理所有方法
export const onRequest: PagesFunction<Env> = async (context) => { ... }

// 只处理 POST
export const onRequestPost: PagesFunction<Env> = async (context) => { ... }

// 只处理 GET
export const onRequestGet: PagesFunction<Env> = async (context) => { ... }
```

**405 Method Not Allowed 的含义**：当 Pages 收到 POST 请求但函数没有导出 `onRequestPost`（只有 `onRequest` 或其他方法的处理器），或者 functions 根本没有被部署，请求会回落到静态资源服务器，而静态资源服务器对 POST 返回 405。

### TypeScript 配置

需要在 `functions/` 目录下放置 `tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "lib": ["esnext"],
    "types": ["./types.d.ts"]
  }
}
```

生成类型：
```bash
npx wrangler types --path='./functions/types.d.ts'
```

如果根目录有 `tsconfig.json`，需要在其中 `exclude` `functions/` 目录避免冲突。

---

## 3. _middleware.ts 的正确位置和格式

### 位置

```
functions/
├── _middleware.ts        ← 作用于整个 /functions 下所有路由
├── api/
│   ├── _middleware.ts    ← 只作用于 /api/* 路由
│   └── transcribe.ts
└── dashscope-asr.ts
```

### 格式

```typescript
// functions/_middleware.ts
export const onRequest: PagesFunction = async (context) => {
  // 前置逻辑（如鉴权）
  const response = await context.next();
  // 后置逻辑（如错误处理）
  return response;
};

// 也可以导出数组实现多个中间件链
export const onRequest = [authMiddleware, errorHandler];
```

**注意**：中间件中必须调用 `context.next()` 才能继续路由链，否则请求不会到达实际的 function。

---

## 4. 兼容性标志 compatibility_flags

### Pages Functions 的配置方式

需要在项目根目录创建 `wrangler.toml`（不是 `workers/api/wrangler.toml`）：
```toml
name = "project-resonance"
pages_build_output_dir = "dist"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

或通过 Cloudflare Dashboard 设置：Settings > Functions > Compatibility flags。

### nodejs_compat 标志

- 启用 Node.js 内置 API 的 polyfill（`node:net`, `node:dns`, `node:timers` 等）
- 需要 `compatibility_date = "2024-09-23"` 或更新

### cloudflare:sockets 的 connect() API

`connect()` API（来自 `cloudflare:sockets` 模块）是 Cloudflare Workers 原生的 TCP socket API，**不是** Node.js 标准库。

```typescript
import { connect } from 'cloudflare:sockets';
```

**关键结论**：
- `cloudflare:sockets` 的 `connect()` API **在 Pages Functions 中可用**（Pages Functions 本质上就是 Workers）
- 它与 `nodejs_compat` 无关，不需要额外标志
- 但 Pages Functions 的 `fetch()` WebSocket upgrade 会 strip `Authorization` header——这正是本项目（project-resonance）选择用 Cloudflare Workers 而非 Pages Functions 的原因

---

## 5. Secrets/环境变量的生效时机

### 结论：**必须重新部署才生效**

官方文档明确说明：

> "when setting secrets with Wrangler or in the Cloudflare dashboard, it needs to be done before a deployment that uses those secrets"

操作流程：
1. 在 Dashboard 设置 secrets（Settings > Variables and Secrets）
2. 触发新部署（重新运行 `wrangler pages deploy`）
3. 新部署的 Function 实例才能读取到新 secrets

**与 Workers 的区别**：Cloudflare Workers 的 `wrangler secret put` 会立即创建新版本并部署。但 Pages Functions 的 secrets 需要等下次部署才生效。

### 本项目的 Workers 方案

`workers/api/wrangler.toml` 中采用了 `--var` 在部署时注入的方式，绕过了 `secret put` 版本隔离问题，是更可靠的方案：
```bash
npx wrangler@4 deploy \
  --var DASHSCOPE_API_KEY:$DASHSCOPE_API_KEY \
  --var WORKER_AUTH_SECRET:$WORKER_AUTH_SECRET
```

---

## 6. 405 根因分析（针对本项目场景）

本项目使用的是 **Cloudflare Workers**（`workers/api/`），不是 Pages Functions（`functions/`）。部署架构是：

```
前端（Cloudflare Pages）     后端（Cloudflare Workers）
project-resonance.pages.dev  project-resonance-api.workers.dev
```

如果访问 `project-resonance.pages.dev/dashscope-asr` 返回 405，可能的原因：

1. **前端请求路径错误**：`VITE_API_URL` 没有正确指向 Workers URL，而是指向了 Pages URL
2. **CORS 问题被误判为 405**：预检 OPTIONS 请求未处理
3. **旧的 functions/ 目录残留**：如果根目录曾有 `functions/` 目录，可能被 wrangler 编译进去但内容不对

### 如果确实想用 Pages Functions（而非独立 Workers）

需要：
```
项目根目录/
├── functions/
│   └── dashscope-asr.ts    # 导出 onRequestPost
├── dist/                   # Vite 构建输出
└── wrangler.toml           # 含 compatibility_flags
```

部署命令（从项目根目录执行）：
```bash
npx wrangler pages deploy dist --project-name project-resonance
```

---

## 7. Advanced Mode（_worker.js）方案

如果文件路由系统不适用，可以用 `_worker.js` 取代 `functions/` 目录：

```
dist/
├── index.html
├── assets/
└── _worker.js    ← 放在静态目录中，优先级最高
```

部署时：
```bash
npx wrangler pages deploy dist --project-name project-resonance
```

Cloudflare 会自动检测 `dist/_worker.js` 并使用它，**完全忽略 `functions/` 目录**。

`_worker.js` 必须使用 Module Worker 语法：
```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/dashscope-asr') {
      // 处理 API 请求
    }
    // 其他请求回落到静态资源
    return env.ASSETS.fetch(request);
  }
};
```

---

## 推荐方案

**当前项目架构（Workers）已是正确选择**，Pages Functions 有以下局限：
1. 无法自定义 functions 目录位置（必须是 CWD 下的 `functions/`）
2. secrets 需要重部署才生效
3. WebSocket upgrade 会 strip Authorization header

**如果 405 问题仍然存在**，排查优先级：
1. 确认 `VITE_API_URL` 指向正确的 Workers URL（`*.workers.dev`），而非 Pages URL
2. 检查 Workers 的 CORS 配置是否处理了 OPTIONS 预检
3. 确认项目根目录没有残留 `functions/` 目录干扰 Pages 部署

---

## 参考资料

- [Cloudflare Pages Functions - Get Started](https://developers.cloudflare.com/pages/functions/get-started/)
- [Wrangler Pages Commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
- [Pages Functions Wrangler Configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages Functions Advanced Mode (_worker.js)](https://developers.cloudflare.com/pages/functions/advanced-mode/)
- [Pages Functions Middleware](https://developers.cloudflare.com/pages/functions/middleware/)
- [Pages Functions TypeScript](https://developers.cloudflare.com/pages/functions/typescript/)
- [Pages Functions Bindings (Secrets)](https://developers.cloudflare.com/pages/functions/bindings/)
- [Compatibility Flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
- [Feature Request: configurable functions directory #3064](https://github.com/cloudflare/workers-sdk/issues/3064)
- [Community: Deploying Pages Functions with wrangler CLI](https://community.cloudflare.com/t/deploying-pages-functions-with-wrangler-cli/409976)
- [Community: 405 Method Not Allowed on POST to onRequestPost](https://community.cloudflare.com/t/post-to-a-onrequestpost-function-returns-405-method-not-allowed/490897)
