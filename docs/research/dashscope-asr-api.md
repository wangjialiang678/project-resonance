# 调研报告: DashScope ASR API

**日期**: 2026-03-17
**任务**: 调研阿里云 DashScope 语音识别 API，重点了解可用模型、REST 调用方式、文件上传支持、音频格式等

---

## 调研摘要

DashScope 提供两条 ASR 调用路径：（1）OpenAI 兼容同步接口（multipart 文件上传，与 StepFun 格式几乎完全一致）；（2）异步任务接口（需要公网 URL，不支持本地文件直传）。对于 project-resonance 的"录完即转写"场景，**推荐使用 OpenAI 兼容同步接口**，迁移成本极低。

---

## 可用模型

| 模型 | 类型 | 特点 |
|------|------|------|
| `paraformer-v2` | 异步文件转录 | 多语种，任意采样率，支持说话人分离 |
| `paraformer-8k-v2` | 异步文件转录 | 中文，8kHz（电话场景） |
| `paraformer-realtime-v2` | **OpenAI 兼容同步接口** | 实时场景，直接文件上传，推荐用于 project-resonance |
| `paraformer-realtime-8k-v2` | OpenAI 兼容同步接口 | 8kHz 版本 |
| `sensevoice-v1` | 已弃用 | **即将下线**，官方建议迁移到 paraformer 或 qwen 系列 |
| `qwen3-asr-flash` | Chat completions（base64 音频） | 高精度，≤5 分钟音频，通过 chat API 调用（非标准 ASR 接口） |
| Fun-ASR / Gummy / 千问录音文件识别 | 其他 | 可用但非主流迁移方向 |

> **SenseVoice 录音文件识别服务即将下线**，官方明确提示需迁移。

---

## 接口一：OpenAI 兼容同步接口（推荐）

**适用场景**：前端录音后直接上传转写，与 StepFun 调用方式相同。

### Endpoint

```
POST https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions
```

### 请求格式

```
Content-Type: multipart/form-data
Authorization: Bearer {DASHSCOPE_API_KEY}
```

请求体字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | 文件 | 音频文件，支持 webm、wav、mp3、ogg 等 |
| `model` | 字符串 | 如 `paraformer-realtime-v2` |

示例（与 StepFun 几乎完全一致）：

```bash
curl -X POST \
  https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -F "file=@recording.webm" \
  -F "model=paraformer-realtime-v2"
```

### 响应格式

```json
{ "text": "转写结果文字" }
```

### 是否需要 SDK

**不需要 SDK**，标准 HTTP multipart/form-data 请求即可。与 StepFun 的 `/v1/audio/transcriptions` 格式完全相同，迁移时只需换 endpoint 和 model 字段。

---

## 接口二：异步文件转录 API（Paraformer 异步，用于批量/长音频）

**注意：此接口不支持本地文件直传，只接受公网 HTTP/HTTPS URL。**

### 提交任务

```
POST https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription
Authorization: Bearer {DASHSCOPE_API_KEY}
Content-Type: application/json
X-DashScope-Async: enable
```

请求体：

```json
{
  "model": "paraformer-v2",
  "input": {
    "file_urls": ["https://example.com/audio.mp3"]
  },
  "parameters": {
    "channel_id": [0],
    "language_hints": ["zh", "en"],
    "diarization_enabled": false,
    "timestamp_alignment_enabled": false,
    "disfluency_removal_enabled": false,
    "vocabulary_id": "vocab-xxxx"
  }
}
```

提交响应：

```json
{
  "output": {
    "task_status": "PENDING",
    "task_id": "c2e5d63b-96e1-4607-bb91-xxxx"
  },
  "request_id": "77ae55ae-be17-97b8-9942-xxxx"
}
```

### 查询任务状态

```
GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
Authorization: Bearer {DASHSCOPE_API_KEY}
```

查询响应（成功时）：

```json
{
  "output": {
    "task_id": "f86ec806-4d73-485f-a24f-xxxx",
    "task_status": "SUCCEEDED",
    "results": [
      {
        "file_url": "https://...",
        "transcription_url": "https://...",
        "subtask_status": "SUCCEEDED"
      }
    ]
  }
}
```

`transcription_url` 为识别结果 JSON 的下载地址，有效期 24 小时。结果 JSON 结构：

```json
{
  "transcripts": [
    {
      "sentences": [
        {
          "speaker_id": 0,
          "begin_time": 1200,
          "end_time": 3800,
          "text": "你好世界"
        }
      ]
    }
  ]
}
```

### 任务状态值

| 状态 | 含义 |
|------|------|
| `PENDING` | 排队中 |
| `RUNNING` | 处理中 |
| `SUCCEEDED` | 完成 |
| `FAILED` | 失败 |
| `CANCELED` | 已取消 |

### 异步接口限制

- **不支持本地文件直传**，也不支持 base64 格式
- 单次请求最多 100 个文件 URL
- 文件大小 ≤ 2GB，时长 ≤ 12 小时
- `transcription_url` 有效期 24 小时

---

## 支持的音频格式

**异步接口**（paraformer-v2）：`aac、amr、avi、flac、flv、m4a、mkv、mov、mp3、mp4、mpeg、ogg、opus、wav、webm、wma、wmv`

**同步接口**（OpenAI 兼容）：`wav、mp3、ogg、webm、flac、aac`（主流格式，**webm 已支持**）

---

## 认证方式

统一使用 Bearer Token：

```
Authorization: Bearer {DASHSCOPE_API_KEY}
```

API Key 在阿里云百炼控制台获取（https://bailian.console.aliyun.com/）。`DASHSCOPE_API_KEY` 在 project-resonance 的 Workers 中已有配置，无需额外申请。

---

## 与项目现状的关联

### 现有架构

- project-resonance 目前用**火山引擎 BigModel ASR**（WebSocket 二进制协议，流式）
- 还有 StepFun ASR（HTTP 同步接口，已有迁移分析）
- TTS/Voice Clone 已通过 Cloudflare Workers 代理调用 DashScope，`DASHSCOPE_API_KEY` 已在 Workers secrets 中

### 已有调研文件

`docs/research/asr-migration-analysis.md`（2026-03-17）已完整分析了 StepFun → DashScope 迁移路径，结论：

- 推荐用 DashScope OpenAI 兼容同步接口（`compatible-mode/v1/audio/transcriptions`）
- 模型：`paraformer-realtime-v2`
- 迁移成本低：前端约 15-20 行改动 + 新建约 50 行 Workers handler

### 关键结论

对于 project-resonance 的使用场景（录音 → 立即转写），使用**同步 multipart 接口**是正确选择：

```
前端录制 webm → Workers → DashScope compatible-mode/v1/audio/transcriptions → { text }
```

**不应使用**异步接口，因为该接口不支持本地文件，需要先上传到公网 URL，增加复杂度。

---

## 参数详解（paraformer-v2 异步，供 transcribe_fusion.py 参考）

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `diarization_enabled` | boolean | false | 说话人分离（仅单声道） |
| `timestamp_alignment_enabled` | boolean | false | 时间戳对齐 |
| `disfluency_removal_enabled` | boolean | false | 过滤语气词 |
| `language_hints` | array | - | 语言代码（zh/en/ja/yue/ko/de/fr/ru） |
| `channel_id` | array | - | 多音轨索引（从 0 起，每路独立计费） |
| `vocabulary_id` | string | - | 热词 ID（仅 v2 系列） |
| `speaker_count` | integer | - | 说话人数量（配合 diarization） |

---

## 参考资料

- DashScope Paraformer 异步 RESTful API 文档：https://help.aliyun.com/zh/model-studio/developer-reference/paraformer-api（需访问实际文档页）
- SenseVoice 弃用通知：https://help.aliyun.com/zh/model-studio/developer-reference/sensevoice-api
- 项目已有迁移分析：`docs/research/asr-migration-analysis.md`
- 现有 Paraformer 调用实现（Python 脚本）：`/Users/michael/SuperBrain 超脑/get笔记原始文件/notes/transcribe_fusion.py`
- DashScope 兼容模式 Base URL：`https://dashscope.aliyuncs.com/compatible-mode/v1`
