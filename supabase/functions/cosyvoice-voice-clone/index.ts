/**
 * CosyVoice Voice Clone Edge Function
 *
 * Flow:
 * 1. Receive audio blob via FormData
 * 2. Upload to Supabase Storage (public bucket) to get a public URL
 * 3. Call CosyVoice REST API to create a cloned voice
 * 4. Return voice_id
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COSYVOICE_CLONE_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Supabase not configured" }),
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

    // Validate file size (max 10MB) and type
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Upload audio to Supabase Storage
    const fileId = crypto.randomUUID();
    const filePath = `voice-clone/${fileId}.wav`;

    console.log("[cosyvoice-clone] Uploading audio to Storage...", filePath);
    const { error: uploadError } = await supabase.storage
      .from("voice-samples")
      .upload(filePath, audioFile, {
        contentType: "audio/wav",
        upsert: false,
      });

    if (uploadError) {
      console.error("[cosyvoice-clone] Storage upload failed:", uploadError);
      return new Response(
        JSON.stringify({
          error: "音频上传失败",
          detail: uploadError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Step 2: Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("voice-samples").getPublicUrl(filePath);

    console.log("[cosyvoice-clone] Public URL:", publicUrl);

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

    // Step 4: Cleanup temp audio (best-effort)
    try {
      await supabase.storage.from("voice-samples").remove([filePath]);
      console.log("[cosyvoice-clone] Temp audio cleaned up");
    } catch (cleanupErr) {
      console.warn("[cosyvoice-clone] Cleanup failed (non-critical):", cleanupErr);
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
