/**
 * CosyVoice Voice Clone — Pages Function
 *
 * POST /cosyvoice-voice-clone
 * Body: multipart/form-data with 'audio' field
 * Returns: { voice_id: string }
 */

interface Env {
  DASHSCOPE_API_KEY: string;
  OSS_BUCKET: string;
  OSS_ENDPOINT: string;
  OSS_ACCESS_KEY_ID: string;
  OSS_ACCESS_KEY_SECRET: string;
}

const COSYVOICE_CLONE_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";

async function hmacSha1(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function ossSign(
  method: string, bucket: string, objectKey: string,
  contentType: string, dateOrExpires: string, accessKeySecret: string,
): Promise<string> {
  const stringToSign = `${method}\n\n${contentType}\n${dateOrExpires}\n/${bucket}/${objectKey}`;
  const sig = await hmacSha1(new TextEncoder().encode(accessKeySecret).buffer as ArrayBuffer, stringToSign);
  return arrayBufferToBase64(sig);
}

async function ossUpload(
  bucket: string, endpoint: string, accessKeyId: string, accessKeySecret: string,
  objectKey: string, body: ArrayBuffer, contentType: string,
): Promise<{ ok: boolean; url: string; error?: string }> {
  const date = new Date().toUTCString();
  const signature = await ossSign("PUT", bucket, objectKey, contentType, date, accessKeySecret);
  const url = `https://${bucket}.${endpoint}/${objectKey}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(url, {
      method: "PUT",
      headers: { Date: date, "Content-Type": contentType, Authorization: `OSS ${accessKeyId}:${signature}` },
      body,
    });
    if (resp.ok) return { ok: true, url };
    const text = await resp.text();
    if (resp.status >= 500 && attempt === 0) { console.warn("[oss] Retry:", resp.status); continue; }
    return { ok: false, url, error: text };
  }
  return { ok: false, url: "", error: "OSS upload failed after retries" };
}

async function ossPresignUrl(
  bucket: string, endpoint: string, accessKeyId: string, accessKeySecret: string,
  objectKey: string, expiresSec = 600,
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
  const signature = await ossSign("GET", bucket, objectKey, "", String(expires), accessKeySecret);
  return `https://${bucket}.${endpoint}/${objectKey}?OSSAccessKeyId=${accessKeyId}&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
}

async function ossDelete(
  bucket: string, endpoint: string, accessKeyId: string, accessKeySecret: string,
  objectKey: string,
): Promise<void> {
  const date = new Date().toUTCString();
  const signature = await ossSign("DELETE", bucket, objectKey, "", date, accessKeySecret);
  const resp = await fetch(`https://${bucket}.${endpoint}/${objectKey}`, {
    method: "DELETE",
    headers: { Date: date, Authorization: `OSS ${accessKeyId}:${signature}` },
  });
  if (!resp.ok) console.warn("[oss] Delete failed:", resp.status);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  let uploadedObjectKey: string | null = null;

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return new Response(JSON.stringify({ error: "Expected multipart/form-data" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return new Response(JSON.stringify({ error: "Missing 'audio' field" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (audioFile.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: "文件过大（最大 10MB）" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const fileId = crypto.randomUUID();
    const mimeType = audioFile.type || "audio/wav";
    const ext = mimeType.includes("webm") ? "webm"
      : mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3"
      : mimeType.includes("ogg") ? "ogg"
      : mimeType.includes("flac") ? "flac"
      : "wav";
    const objectKey = `voice-clone/${fileId}.${ext}`;

    console.log("[clone] Uploading to OSS:", objectKey, "mimeType:", mimeType);
    const audioBuffer = await audioFile.arrayBuffer();
    const uploadResult = await ossUpload(
      env.OSS_BUCKET, env.OSS_ENDPOINT, env.OSS_ACCESS_KEY_ID, env.OSS_ACCESS_KEY_SECRET,
      objectKey, audioBuffer, mimeType,
    );

    if (!uploadResult.ok) {
      console.error("[clone] OSS upload failed:", uploadResult.error);
      return new Response(JSON.stringify({ error: "音频上传失败", detail: uploadResult.error }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
    uploadedObjectKey = objectKey;

    const publicUrl = await ossPresignUrl(
      env.OSS_BUCKET, env.OSS_ENDPOINT, env.OSS_ACCESS_KEY_ID, env.OSS_ACCESS_KEY_SECRET,
      objectKey, 600,
    );

    const prefix = "usr" + fileId.replace(/-/g, "").slice(0, 7);
    console.log("[clone] Creating voice, prefix:", prefix);

    const cloneResp = await fetch(COSYVOICE_CLONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voice-enrollment",
        input: {
          action: "create_voice",
          target_model: "cosyvoice-v3-flash",
          prefix,
          url: publicUrl,
        },
      }),
    });

    const rawResult = await cloneResp.text();
    let cloneResult: Record<string, unknown> = {};
    try { cloneResult = rawResult ? JSON.parse(rawResult) as Record<string, unknown> : {}; }
    catch { cloneResult = { error: rawResult || "Invalid response" }; }

    if (!cloneResp.ok || cloneResult.code) {
      const errMsg = (cloneResult.message || cloneResult.code || "Clone API error") as string;
      console.error("[clone] Failed:", errMsg);
      return new Response(JSON.stringify({ error: "声音克隆失败", detail: errMsg }), {
        status: cloneResp.ok ? 400 : cloneResp.status, headers: { "Content-Type": "application/json" },
      });
    }

    const output = cloneResult.output as Record<string, unknown> | undefined;
    const voiceId = output?.voice_id as string | undefined;
    if (!voiceId) {
      return new Response(JSON.stringify({ error: "未获取到音色 ID", detail: JSON.stringify(cloneResult) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    console.log("[clone] SUCCESS:", voiceId);
    return new Response(JSON.stringify({ voice_id: voiceId }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[clone] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  } finally {
    if (uploadedObjectKey) {
      try {
        await ossDelete(env.OSS_BUCKET, env.OSS_ENDPOINT, env.OSS_ACCESS_KEY_ID, env.OSS_ACCESS_KEY_SECRET, uploadedObjectKey);
      } catch (err) { console.warn("[clone] OSS cleanup:", err); }
    }
  }
};
