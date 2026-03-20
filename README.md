# Project Resonance 共鸣

为重度构音障碍者设计的语音识别训练与辅助沟通系统。

用户录制少量练习音频，系统学习识别其特定发音模式，将模糊语音转译为预设短语，并通过 TTS 播报——让无法被常人理解的声音重新被"听懂"。

> 超脑 AI 孵化器 · AI for Good 公益项目

**线上体验**: https://project-resonance.pages.dev

## 功能

- **短语管理** — 按生活场景（生理需求、照护协助、紧急求助等）预设常用表达
- **语音训练** — 对每个短语录制 ≥2 条音频样本，系统学习用户发音模式
- **实时识别** — 将用户语音与已训练短语匹配，返回最佳结果
- **TTS 播报** — 识别结果通过语音合成播放，支持声音克隆保留用户音色
- **离线优先** — 所有数据存 localStorage，无需登录即可使用

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| 后端 | Cloudflare Pages Functions |
| ASR | DashScope qwen3-asr-flash |
| TTS | CosyVoice TTS + Voice Clone |
| 跨端 | Capacitor (Android/iOS) + 微信小程序 WebView |

## 快速开始

```bash
npm install --legacy-peer-deps
npm run dev          # 启动开发服务器 :8080
npm run test         # 运行测试
npm run build        # 生产构建
```

## 部署

```bash
# 构建 + 部署到 Cloudflare Pages（含 Pages Functions）
npx vite build && npx wrangler pages deploy dist --project-name project-resonance --branch main
```

> `--branch main` 是必须的，否则会部署到 preview 环境（secrets 不可用）。

## 项目结构

```
src/
├── pages/          # 路由页面（Usage、Training、Phrases、Settings、Welcome）
├── components/     # 业务组件 + shadcn/ui 基础组件
├── hooks/          # 数据管理、ASR、TTS、录音等 hooks
├── services/       # ASR 服务封装
├── data/           # 预设短语、快捷键分组
├── utils/          # API 错误处理等工具
└── types/          # 类型定义

functions/          # Cloudflare Pages Functions（API 后端）
├── _middleware.ts   # CORS + X-App-Token 鉴权
├── dashscope-asr.ts
├── cosyvoice-tts.ts
└── cosyvoice-voice-clone.ts

docs/handoff/       # 团队交接文档
```

## 文档

- [CLAUDE.md](CLAUDE.md) — 完整技术参考（架构、环境变量、部署细节）
- [docs/handoff/](docs/handoff/) — 团队交接文档（架构迁移、UX 变更、开发环境配置、部署手册）
- [docs/test-plan.md](docs/test-plan.md) — 三层测试方案

## License

MIT
