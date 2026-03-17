# 调研报告：国内手机号验证登录方案

**日期**: 2026-03-17
**任务**: 为 Project Resonance（共鸣）设计手机号 + 短信验证码登录方案，后端运行在 Cloudflare Workers，替换现有 Supabase Auth + 七牛云短信实现。

---

## 调研摘要

推荐方案：**阿里云短信 + 纯自建 Cloudflare Workers OTP 认证体系**。

理由：用户已有阿里云账号和 API Key，阿里云短信在国内三大运营商覆盖最全、到达率最高；自建方案将 OTP 存储于 Cloudflare D1、Session 存储于 Cloudflare KV，完全在 Cloudflare 生态内闭环，无额外第三方依赖；阿里云短信 V3 签名可完全通过 Web Crypto API（`SubtleCrypto`）实现，与 Cloudflare Workers 运行时 100% 兼容。微信小程序手机号授权可作为进阶补充方案，但因需企业资质（非个人开发者），暂不列为首选。

---

## 现有代码分析

### 相关文件

- `src/pages/AuthPage.tsx` — 前端认证页面，已有完整的手机号 OTP UI（发送/验证两步流程），当前 phone tab 被 `disabled`，标注"即将上线"
- `src/hooks/useAuth.ts` — 封装 Supabase Auth 状态管理（`onAuthStateChange`、`getSession`、`signOut`）
- `src/integrations/supabase/client.ts` — Supabase 客户端，含 `persistSession: true`、`autoRefreshToken: true`
- `supabase/functions/sms-send-otp/index.ts` — 七牛云短信发送逻辑（HMAC-SHA1 签名）+ OTP 写入 `phone_otps` 表
- `supabase/functions/sms-verify-otp/index.ts` — OTP 校验 + Supabase Admin 建用户/生成 magic link token

### 现有模式

- OTP 存储在 Supabase PostgreSQL `phone_otps` 表（`phone`, `code`, `expires_at`, `verified`）
- 用户身份以 `{phone}@phone.local` 虚拟邮箱绑定到 Supabase Auth
- 七牛云短信签名：HMAC-SHA1，已用 Web Crypto API 实现，**签名逻辑可直接迁移到 Cloudflare Workers**
- 前端通过 `supabase.functions.invoke()` 调用 Edge Functions，迁移后需改为直接 `fetch()` 调用 Cloudflare Workers API

### 可复用组件

- `AuthPage.tsx` 的 UI 层（手机号输入、OTP 输入、两步流程状态）**完全可以复用**，只需替换 API 调用方式
- 七牛云签名的 Web Crypto API 实现模式（HMAC + `SubtleCrypto`）可作为阿里云 V3 签名实现的参考
- OTP 生成逻辑（`Math.floor(100000 + Math.random() * 900000)`）可沿用

---

## 技术方案

### 方案 A：阿里云短信 + 纯自建 Cloudflare Workers（推荐）

**描述**：Cloudflare Workers 处理 OTP 发送和验证逻辑，阿里云短信 API（HTTP V3 签名）发送短信，OTP 记录存 Cloudflare D1（SQLite），用户 Session Token 存 Cloudflare KV，JWT 用 `@tsndr/cloudflare-worker-jwt` 库（零依赖，专为 Workers 设计）。

**优点**：
- 阿里云短信：国内覆盖最好，三网通，到达率高，用户已有账号无需重新开户
- 完全在 Cloudflare 生态内：Workers + D1 + KV，无额外服务依赖
- 阿里云短信 V3 签名仅需 `SubtleCrypto.digest` 和 `SubtleCrypto.sign`（HMAC-SHA256），Workers 原生支持
- 可精确控制用户数据模型，无 Supabase 的"虚拟邮箱"绕路
- Cloudflare Workers 内置 Rate Limiting API，防刷直接原生支持
- 开源 JWT 库 `@tsndr/cloudflare-worker-jwt` 867+ Star，活跃维护，专为此场景设计

**缺点**：
- 需要实现阿里云 V3 签名（约 50 行代码，有明确文档）
- 需要手动管理 JWT Refresh Token 逻辑
- 需要在阿里云控制台申请短信签名和模板（审核通常 1-2 个工作日）

**实现复杂度**：中

---

### 方案 B：腾讯云短信 + 纯自建 Cloudflare Workers

**描述**：与方案 A 相同架构，仅 SMS 服务商换为腾讯云。

**优点**：
- 腾讯云短信 API 封装略比阿里云简洁，文档完善
- 有免费套餐（新用户赠 100 条）

**缺点**：
- 用户需额外开通腾讯云账号，而已有阿里云账号
- 腾讯云短信签名审核需企业认证（个人用途受限）
- 同样需要实现 TC3-HMAC-SHA256 签名

**实现复杂度**：中

---

### 方案 C：七牛云短信（保持现有服务商）+ 迁移到 Cloudflare Workers

**描述**：保持七牛云短信，仅将后端从 Supabase Edge Functions 迁移到 Cloudflare Workers。

**优点**：
- 七牛云签名代码已经实现，可直接复制，迁移成本最低
- 现有短信模板和签名已审核通过

**缺点**：
- 七牛云是存储+CDN 主业，短信是附属产品，稳定性和优先级低于阿里云/腾讯云
- 七牛云短信无免费额度（仅新用户测试 300 条）
- 价格偏高（验证码约 0.043 元/条起，套餐制），按量付费不如阿里云灵活

**实现复杂度**：低（签名代码已有）

---

### 方案 D：微信小程序手机号快速验证（辅助方案）

**描述**：利用项目已有微信小程序壳，通过 `wx.getPhoneNumber` 获取用户授权手机号，后端解密验证，替代短信验证码。

**优点**：
- 用户体验最好：无需手动输入验证码，一键授权
- 无短信费用
- 手机号真实性由微信平台保证

**缺点**：
- **必须企业认证**：个人开发者无法使用 `getPhoneNumber`，需完成微信企业认证（300 元/年）
- 仅适用于微信小程序端，H5 / App 端无法使用，需另备短信登录
- 后端需实现微信 session_key 解密（AES-128-CBC）

**实现复杂度**：中（微信端简单，但 H5 端必须备案短信方案）

---

## 推荐方案

**推荐方案 A：阿里云短信 + 纯自建 Cloudflare Workers**

**理由**：
1. 用户已有阿里云账号和 API Key，零开户成本
2. 阿里云短信是国内最主流的验证码 SMS 服务，三网到达率最高，申请模板流程最成熟
3. 架构完全在 Cloudflare 生态内（Workers + D1 + KV），与项目已确定的技术方向一致
4. V3 签名实现复杂度可控（参考下方代码示例），有官方文档支撑
5. 原生 Rate Limiting 直接集成，防刷成本为零

**未来可叠加**：方案 D（微信小程序手机号授权）作为补充，当项目完成企业认证后，在小程序端提供无短信验证码的一键登录体验。

---

## 价格对比

| 服务商 | 按量单价（验证码） | 套餐包最低价 | 免费额度 | 个人账号可用 |
|--------|------------------|------------|---------|------------|
| 阿里云 | 0.045 元/条（<10万条/月） | 0.039元（50万条包） | 无（有体验资源） | 是 |
| 腾讯云 | 0.045 元/条 | 约 0.04 元（套餐） | 新用户 100 条 | 受限（推广短信需企业） |
| 七牛云 | 0.043 元/条（套餐） | 套餐制，不按量 | 企业认证后 300 条 | 是 |

**建议**：Project Resonance 为公益项目，用量初期较小，选择阿里云按量付费即可，无需预购套餐。

---

## 数据模型设计

### Cloudflare D1 建表 SQL

```sql
-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  phone       TEXT NOT NULL UNIQUE,       -- 11位国内手机号，不含+86
  display_name TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- OTP 表（短期记录，可定期清理）
CREATE TABLE IF NOT EXISTS phone_otps (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,               -- 6位数字
  expires_at INTEGER NOT NULL,            -- Unix timestamp（秒）
  verified   INTEGER NOT NULL DEFAULT 0,  -- 0=未验证, 1=已验证
  attempts   INTEGER NOT NULL DEFAULT 0,  -- 错误尝试次数
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_phone ON phone_otps(phone, verified);
CREATE INDEX IF NOT EXISTS idx_phone_otps_expires ON phone_otps(expires_at);
```

### Cloudflare KV 存储结构

```
Key:   session:{token}
Value: JSON { user_id, phone, created_at, expires_at }
TTL:   30天（2592000秒）

Key:   refresh:{refresh_token}
Value: JSON { user_id, phone, created_at, expires_at }
TTL:   90天（7776000秒）
```

---

## API 设计

### POST /api/auth/send-otp

**请求体**：
```json
{ "phone": "13800138000" }
```

**响应（成功）**：
```json
{ "success": true }
```

**响应（开发模式，未配置 SMS）**：
```json
{ "success": true, "dev_code": "123456" }
```

**错误响应**：
```json
{ "error": "无效的手机号格式" }  // 400
{ "error": "发送频率过高，请60秒后重试" }  // 429
{ "error": "短信发送失败" }  // 500
```

---

### POST /api/auth/verify-otp

**请求体**：
```json
{
  "phone": "13800138000",
  "code": "123456",
  "display_name": "用户昵称（可选，首次注册）"
}
```

**响应（成功）**：
```json
{
  "success": true,
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600,
  "user": {
    "id": "abc123",
    "phone": "13800138000",
    "display_name": "用户昵称"
  }
}
```

---

### POST /api/auth/refresh

**请求体**：
```json
{ "refresh_token": "eyJ..." }
```

**响应**：
```json
{
  "access_token": "eyJ...",
  "expires_in": 3600
}
```

---

### POST /api/auth/logout

**Header**: `Authorization: Bearer {access_token}`

**响应**：`{ "success": true }`（同时删除 KV 中的 session 记录）

---

## 核心实现代码示例

### 1. 阿里云短信 V3 签名（Cloudflare Workers）

```typescript
// workers/src/lib/aliyun-sms.ts

interface SendSmsParams {
  phone: string;
  code: string;
  signName: string;       // 短信签名名称，如"共鸣"
  templateCode: string;   // 短信模板CODE，如"SMS_123456789"
}

async function sendAliyunSms(
  accessKeyId: string,
  accessKeySecret: string,
  params: SendSmsParams
): Promise<void> {
  const action = 'SendSms';
  const version = '2017-05-25';
  const host = 'dysmsapi.aliyuncs.com';

  // 请求体（查询参数以 JSON body 方式传递）
  const bodyParams = {
    PhoneNumbers: params.phone,
    SignName: params.signName,
    TemplateCode: params.templateCode,
    TemplateParam: JSON.stringify({ code: params.code }),
  };
  const bodyStr = new URLSearchParams(bodyParams).toString();

  // 构建必要请求头
  const date = new Date().toUTCString().replace('GMT', '+0000');
  const nonce = crypto.randomUUID().replace(/-/g, '');

  // 计算 body hash（SHA-256 hex）
  const bodyHash = await sha256hex(bodyStr);

  // 构造待签名字符串（Canonical Request）
  // Method + '\n' + URI + '\n' + QueryString + '\n' + CanonicalHeaders + '\n' + SignedHeaders + '\n' + BodyHash
  const canonicalHeaders = [
    `host:${host}`,
    `x-acs-action:${action}`,
    `x-acs-content-sha256:${bodyHash}`,
    `x-acs-date:${date}`,
    `x-acs-signature-nonce:${nonce}`,
    `x-acs-version:${version}`,
  ].join('\n');

  const signedHeaders = 'host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version';

  const canonicalRequest = [
    'POST',    // Method
    '/',       // URI（RPC 接口固定为 /）
    '',        // QueryString（body 传参时为空）
    canonicalHeaders,
    '',        // 空行
    signedHeaders,
    bodyHash,
  ].join('\n');

  // StringToSign
  const canonicalRequestHash = await sha256hex(canonicalRequest);
  const stringToSign = `ACS3-HMAC-SHA256\n${canonicalRequestHash}`;

  // 计算签名
  const signature = await hmacSha256Hex(accessKeySecret, stringToSign);

  // Authorization header
  const authorization = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      'Host': host,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': authorization,
      'x-acs-action': action,
      'x-acs-version': version,
      'x-acs-date': date,
      'x-acs-signature-nonce': nonce,
      'x-acs-content-sha256': bodyHash,
    },
    body: bodyStr,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`阿里云短信发送失败: ${errText}`);
  }

  const result = await response.json() as { Code?: string; Message?: string };
  if (result.Code !== 'OK') {
    throw new Error(`短信发送失败: ${result.Message} (${result.Code})`);
  }
}

// --- 工具函数（使用 Workers 原生 SubtleCrypto）---

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

---

### 2. OTP 发送 Worker 路由（Hono 框架）

```typescript
// workers/src/routes/auth.ts
import { Hono } from 'hono';
import { sendAliyunSms } from '../lib/aliyun-sms';

const auth = new Hono<{ Bindings: Env }>();

// POST /api/auth/send-otp
auth.post('/send-otp', async (c) => {
  const { phone } = await c.req.json<{ phone: string }>();

  // 校验手机号格式
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return c.json({ error: '无效的手机号格式' }, 400);
  }

  // Rate Limiting：每个手机号 60 秒内只允许发 1 次
  const rateLimitResult = await c.env.RATE_LIMITER.limit({ key: `send-otp:${phone}` });
  if (!rateLimitResult.success) {
    return c.json({ error: '发送频率过高，请60秒后重试' }, 429);
  }

  // 生成 6 位 OTP
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60; // 5分钟后过期

  // 删除该手机号的旧 OTP，插入新 OTP
  await c.env.DB.prepare(`
    DELETE FROM phone_otps WHERE phone = ? AND verified = 0
  `).bind(phone).run();

  await c.env.DB.prepare(`
    INSERT INTO phone_otps (phone, code, expires_at) VALUES (?, ?, ?)
  `).bind(phone, code, expiresAt).run();

  // 发送短信
  const isDevMode = !c.env.ALIYUN_ACCESS_KEY_ID;
  if (isDevMode) {
    console.warn('开发模式：未配置阿里云短信，直接返回验证码');
    return c.json({ success: true, dev_code: code });
  }

  await sendAliyunSms(
    c.env.ALIYUN_ACCESS_KEY_ID,
    c.env.ALIYUN_ACCESS_KEY_SECRET,
    {
      phone,
      code,
      signName: c.env.ALIYUN_SMS_SIGN_NAME,
      templateCode: c.env.ALIYUN_SMS_TEMPLATE_CODE,
    }
  );

  return c.json({ success: true });
});

// POST /api/auth/verify-otp
auth.post('/verify-otp', async (c) => {
  const { phone, code, display_name } = await c.req.json<{
    phone: string;
    code: string;
    display_name?: string;
  }>();

  if (!phone || !code) {
    return c.json({ error: '手机号和验证码必填' }, 400);
  }

  // 查找有效 OTP（未过期、未验证、最多5次尝试）
  const now = Math.floor(Date.now() / 1000);
  const otp = await c.env.DB.prepare(`
    SELECT * FROM phone_otps
    WHERE phone = ? AND verified = 0 AND expires_at > ? AND attempts < 5
    ORDER BY created_at DESC LIMIT 1
  `).bind(phone, now).first<{ id: string; code: string; attempts: number }>();

  if (!otp) {
    return c.json({ error: '验证码不存在或已过期' }, 400);
  }

  // 验证码错误：记录尝试次数
  if (otp.code !== code) {
    await c.env.DB.prepare(`
      UPDATE phone_otps SET attempts = attempts + 1 WHERE id = ?
    `).bind(otp.id).run();
    return c.json({ error: '验证码错误' }, 400);
  }

  // 标记 OTP 已使用
  await c.env.DB.prepare(`
    UPDATE phone_otps SET verified = 1 WHERE id = ?
  `).bind(otp.id).run();

  // 查找或创建用户
  let user = await c.env.DB.prepare(`
    SELECT * FROM users WHERE phone = ?
  `).bind(phone).first<{ id: string; phone: string; display_name: string }>();

  if (!user) {
    const userId = crypto.randomUUID().replace(/-/g, '');
    await c.env.DB.prepare(`
      INSERT INTO users (id, phone, display_name) VALUES (?, ?, ?)
    `).bind(userId, phone, display_name || phone).run();
    user = { id: userId, phone, display_name: display_name || phone };
  }

  // 生成 Access Token（1小时）和 Refresh Token（30天）
  const { sign } = await import('@tsndr/cloudflare-worker-jwt');
  const jwtSecret = c.env.JWT_SECRET;

  const accessToken = await sign(
    { sub: user.id, phone: user.phone, exp: Math.floor(Date.now() / 1000) + 3600 },
    jwtSecret
  );

  const refreshToken = await sign(
    { sub: user.id, type: 'refresh', exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 },
    jwtSecret
  );

  // 将 session 存入 KV（TTL = 30天）
  await c.env.KV.put(
    `session:${accessToken}`,
    JSON.stringify({ user_id: user.id, phone: user.phone }),
    { expirationTtl: 3600 }
  );

  await c.env.KV.put(
    `refresh:${refreshToken}`,
    JSON.stringify({ user_id: user.id, phone: user.phone }),
    { expirationTtl: 30 * 24 * 3600 }
  );

  return c.json({
    success: true,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
    user: { id: user.id, phone: user.phone, display_name: user.display_name },
  });
});

export { auth };
```

---

### 3. wrangler.toml 配置

```toml
name = "project-resonance-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"

# D1 数据库
[[d1_databases]]
binding = "DB"
database_name = "resonance-auth"
database_id = "YOUR_D1_DATABASE_ID"

# KV 命名空间（存 session）
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"

# Rate Limiter（发送OTP：每个手机号60秒1次）
[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"

[ratelimits.simple]
limit = 1
period = 60

# 环境变量（敏感信息用 wrangler secret）
# wrangler secret put ALIYUN_ACCESS_KEY_ID
# wrangler secret put ALIYUN_ACCESS_KEY_SECRET
# wrangler secret put JWT_SECRET
[vars]
ALIYUN_SMS_SIGN_NAME = "共鸣"
ALIYUN_SMS_TEMPLATE_CODE = "SMS_XXXXXXXXX"
```

---

### 4. 前端 useAuth Hook 替换思路

```typescript
// src/hooks/useAuth.ts（迁移后版本骨架）
// 替换 supabase.auth 为直接 fetch Workers API

const API_BASE = import.meta.env.VITE_API_URL; // e.g. https://project-resonance-api.workers.dev

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 从 localStorage 读取 access_token，验证有效性
    const token = localStorage.getItem('access_token');
    if (token) {
      // 解码 JWT payload（无需验签，仅读取 user 信息）
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp > Date.now() / 1000) {
          setUser({ id: payload.sub, phone: payload.phone });
        } else {
          // Token 过期，尝试 refresh
          refreshToken();
        }
      } catch {}
    }
    setLoading(false);
  }, []);

  const sendOtp = async (phone: string) => {
    const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    return res.json();
  };

  const verifyOtp = async (phone: string, code: string, displayName?: string) => {
    const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, display_name: displayName }),
    });
    const data = await res.json();
    if (data.access_token) {
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      setUser(data.user);
    }
    return data;
  };

  const signOut = async () => {
    const token = localStorage.getItem('access_token');
    if (token) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  };

  return { user, loading, sendOtp, verifyOtp, signOut };
}
```

---

## 阿里云短信申请流程

1. 登录阿里云控制台 → 短信服务（dysms.console.aliyun.com）
2. 国内消息 → 签名管理 → 添加签名
   - 签名来源：选"适用于网站"
   - 签名名称：`共鸣`（或项目英文名）
   - 用途说明：非营利公益语音辅助系统
   - 上传网站截图或备案信息
   - 审核时间：1-2 个工作日
3. 模板管理 → 添加模板
   - 模板类型：验证码
   - 模板名称：登录验证码
   - 模板内容：`您的验证码为：${code}，5分钟内有效，请勿泄露。`
   - 审核时间：1-2 个工作日
4. 获取 AccessKey ID 和 AccessKey Secret（RAM 控制台 → 创建 RAM 用户，仅授予 `AliyunDysmsFullAccess`）

---

## 安全考量

| 威胁 | 缓解措施 |
|------|---------|
| 验证码爆破 | 每次 OTP 最多尝试 5 次，超过自动失效；Cloudflare Rate Limiter：每手机号 60 秒 1 次发送 |
| OTP 泄露 | 验证码 5 分钟过期；验证成功后立即标记 `verified=1`，不可二次使用 |
| 短信轰炸（薅羊毛） | Rate Limiter 基于手机号；全局 IP 频率限制可叠加 |
| JWT 伪造 | 签名密钥存于 Workers Secret，不在代码中；使用 HS256 算法 |
| Session 劫持 | Access Token TTL 1小时；Refresh Token 存 KV，可服务端主动撤销 |
| OTP 历史记录 | 发送新 OTP 前清除该手机号的旧未验证 OTP |

---

## 实施建议

### 关键步骤

1. **创建 Cloudflare Workers 项目**：`npm create cloudflare@latest resonance-api -- --type hono`
2. **创建 D1 数据库**：`wrangler d1 create resonance-auth`，执行上方建表 SQL
3. **创建 KV 命名空间**：`wrangler kv:namespace create SESSIONS`
4. **配置 Secrets**：`wrangler secret put ALIYUN_ACCESS_KEY_ID` 等（共4个 secret）
5. **申请阿里云短信签名和模板**（并行进行，需 1-2 工作日）
6. **实现 Workers 逻辑**：参考上方代码，接入阿里云短信签名模块
7. **本地开发测试**：先不配置 ALIYUN_* 变量，走 `dev_code` 模式验证 D1/KV 流程
8. **前端替换 useAuth**：将 Supabase 调用替换为 fetch Workers API
9. **前端启用手机 Tab**：移除 `AuthPage.tsx` 中 phone tab 的 `disabled` 属性
10. **端到端联调**：先测试发短信 → 收到验证码 → 验证登录 → 刷新 Token → 退出登录

### 风险点

- **阿里云模板审核被拒** — 缓解：提前准备，用业务描述（公益无障碍项目）提交审核；审核期间走 dev_code 模式继续开发
- **V3 签名实现有误** — 缓解：参考官方文档逐步验证，先用 curl + 已知 AK/SK 对比请求，确认签名正确后再集成
- **Cloudflare Workers 免费版限制** — 缓解：免费版每天 10 万次请求，项目初期完全足够；KV 免费版 10 万次读/天，session 查询量级不会达到上限
- **前端 Auth 状态切换** — 缓解：`useAuth` hook 保持接口兼容（`user`, `loading`, `signOut`），只有调用层变化，其他组件无需修改

### 依赖项

- `@tsndr/cloudflare-worker-jwt` — npm 包，零依赖，专为 Workers 设计
- `hono` — Workers 路由框架（可选，也可用原生 Request/Response）
- 阿里云短信签名和模板（需提前申请）
- Cloudflare D1、KV、Rate Limiting（均为 Cloudflare 原生，无需额外申请）

---

## 附：微信小程序手机号授权（进阶方案，待企业认证后实施）

微信小程序已有 `miniprogram/` 目录，且有 webview 页面。完成企业微信认证后，可在小程序端增加"微信手机号快速验证"入口：

1. 前端（小程序）：`<button open-type="getPhoneNumber" bindgetphonenumber="onGetPhone">微信手机号快速登录</button>`
2. 回调中获取 `code`（非 `encryptedData`，新版接口更简单）
3. 后端（Workers）：用 `code` 换取 `phone_info`（POST `https://api.weixin.qq.com/wxa/business/getuserphonenumber`）
4. 得到真实手机号后，走与短信验证相同的用户查找/创建 + JWT 颁发流程

此方案与短信方案共享同一套用户表和 JWT 体系，仅"获取手机号"的方式不同，实现成本低。

---

## 参考资料

- [阿里云短信 SendSms API 文档](https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-sendsms)
- [阿里云 OpenAPI V3 签名机制](https://www.alibabacloud.com/help/zh/sdk/product-overview/v3-request-structure-and-signature)
- [cloudflare-worker-jwt — GitHub](https://github.com/tsndr/cloudflare-worker-jwt)
- [Cloudflare Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [Cloudflare KV 文档](https://developers.cloudflare.com/kv/)
- [微信小程序 getPhoneNumber 文档](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)
- [Cloudflare Workers + D1 认证实现参考](https://massadas.com/posts/implementing-register-and-login-in-workers-d1/)
- [阿里云短信计费说明](https://help.aliyun.com/zh/sms/product-overview/billing-of-messages-sent-to-chinese-mainland)
