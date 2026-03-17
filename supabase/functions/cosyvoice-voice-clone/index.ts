/**
 * CosyVoice Voice Clone Edge Function
 *
 * Flow:
 * 1. Receive audio blob via FormData
 * 2. Upload to Alibaba Cloud OSS to get a public URL (same cloud as CosyVoice, near-zero latency)
 * 3. Call CosyVoice REST API to create a cloned voice
 * 4. Cleanup temp OSS object
 * 5. Return voice_id
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COSYVOICE_CLONE_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";

// --- OSS Helpers (HMAC-SHA1 signature) ---

async function hmacSha1(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
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
  method: string,
  bucket: string,
  objectKey: string,
  contentType: string,
  dateOrExpires: string,
  accessKeySecret: string,
): Promise<string> {
  const stringToSign = `${method}\n\n${contentType}\n${dateOrExpires}\n/${bucket}/${objectKey}`;
  const sig = await hmacSha1(new TextEncoder().encode(accessKeySecret).buffer, stringToSign);
  return arrayBufferToBase64(sig);
}

async function ossUpload(
  bucket: string,
  endpoint: string,
  accessKeyId: string,
  accessKeySecret: string,
  objectKey: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<{ ok: boolean; status: number; url: string; error?: string }> {
  const date = new Date().toUTCString();
  const signature = await ossSign("PUT", bucket, objectKey, contentType, date, accessKeySecret);
  const url = `https://${bucket}.${endpoint}/${objectKey}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Date: date,
      "Content-Type": contentType,
      Authorization: `OSS ${accessKeyId}:${signature}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, status: resp.status, url, error: text };
  }
  return { ok: true, status: resp.status, url };
}

/** Generate a pre-signed URL for GET access (valid for `expiresSec` seconds) */
async function ossPresignUrl(
  bucket: string,
  endpoint: string,
  accessKeyId: string,
  accessKeySecret: string,
  objectKey: string,
  expiresSec = 600,
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
  const signature = await ossSign("GET", bucket, objectKey, "", String(expires), accessKeySecret);
  const encodedSig = encodeURIComponent(signature);
  return `https://${bucket}.${endpoint}/${objectKey}?OSSAccessKeyId=${accessKeyId}&Expires=${expires}&Signature=${encodedSig}`;
}

async function ossDelete(
  bucket: string,
  endpoint: string,
  accessKeyId: string,
  accessKeySecret: string,
  objectKey: string,
): Promise<void> {
  const date = new Date().toUTCString();
  const signature = await ossSign("DELETE", bucket, objectKey, "", date, accessKeySecret);
  const url = `https://${bucket}.${endpoint}/${objectKey}`;

  await fetch(url, {
    method: "DELETE",
    headers: {
      Date: date,
      Authorization: `OSS ${accessKeyId}:${signature}`,
    },
  });
}

// --- Main handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const dashscopeKey = Deno.env.get("DASHSCOPE_API_KEY");
  if (!dashscopeKey) {
    return new Response(
      JSON.stringify({ error: "DASHSCOPE_API_KEY not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const ossBucket = Deno.env.get("OSS_BUCKET");
  const ossEndpoint = Deno.env.get("OSS_ENDPOINT");
  const ossKeyId = Deno.env.get("OSS_ACCESS_KEY_ID");
  const ossKeySecret = Deno.env.get("OSS_ACCESS_KEY_SECRET");
  if (!ossBucket || !ossEndpoint || !ossKeyId || !ossKeySecret) {
    return new Response(
      JSON.stringify({ error: "OSS not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return new Response(
        JSON.stringify({ error: "Expected multipart/form-data" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return new Response(
        JSON.stringify({ error: "Missing 'audio' field" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate file size (max 10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (audioFile.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: "文件过大（最大 10MB）" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Step 1: Upload audio to Alibaba Cloud OSS
    const fileId = crypto.randomUUID();
    const objectKey = `voice-clone/${fileId}.wav`;

    console.log("[cosyvoice-clone] Uploading audio to OSS...", objectKey);
    const audioBuffer = await audioFile.arrayBuffer();
    const uploadResult = await ossUpload(
      ossBucket,
      ossEndpoint,
      ossKeyId,
      ossKeySecret,
      objectKey,
      audioBuffer,
      "audio/wav",
    );

    if (!uploadResult.ok) {
      console.error("[cosyvoice-clone] OSS upload failed:", uploadResult.error);
      return new Response(
        JSON.stringify({
          error: "音频上传失败",
          detail: uploadResult.error,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Step 2: Generate pre-signed URL (valid 10 minutes, enough for CosyVoice to download)
    const publicUrl = await ossPresignUrl(
      ossBucket, ossEndpoint, ossKeyId, ossKeySecret, objectKey, 600,
    );
    console.log("[cosyvoice-clone] Pre-signed URL generated");

    // Step 3: Call CosyVoice clone API
    // prefix: only lowercase letters and digits, max 10 chars
    const prefix = "usr" + fileId.replace(/-/g, "").slice(0, 7);

    console.log("[cosyvoice-clone] Creating voice clone, prefix:", prefix);
    const cloneResp = await fetch(COSYVOICE_CLONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashscopeKey}`,
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

    const cloneResult = await cloneResp.json();
    console.log(
      "[cosyvoice-clone] Clone API response:",
      JSON.stringify(cloneResult),
    );

    if (!cloneResp.ok || cloneResult.code) {
      const errMsg =
        cloneResult.message || cloneResult.code || "Clone API error";
      console.error("[cosyvoice-clone] Clone failed:", errMsg);
      return new Response(
        JSON.stringify({ error: "声音克隆失败", detail: errMsg }),
        {
          status: cloneResp.ok ? 400 : cloneResp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const voiceId = cloneResult?.output?.voice_id;
    if (!voiceId) {
      console.error(
        "[cosyvoice-clone] No voice_id in response:",
        JSON.stringify(cloneResult),
      );
      return new Response(
        JSON.stringify({
          error: "未获取到音色 ID",
          detail: JSON.stringify(cloneResult),
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Step 4: Cleanup temp audio from OSS (best-effort)
    try {
      await ossDelete(ossBucket, ossEndpoint, ossKeyId, ossKeySecret, objectKey);
      console.log("[cosyvoice-clone] Temp audio cleaned up from OSS");
    } catch (cleanupErr) {
      console.warn("[cosyvoice-clone] OSS cleanup failed (non-critical):", cleanupErr);
    }

    console.log("[cosyvoice-clone] SUCCESS, voice_id:", voiceId);
    return new Response(JSON.stringify({ voice_id: voiceId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[cosyvoice-clone] Error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
