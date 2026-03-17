/**
 * DashScope ASR Handler
 *
 * Uses qwen3-asr-flash via chat completions API.
 * Flow: FormData audio → base64 → chat completions → text
 */

import type { ValidatedEnv } from "./env";
import { corsResponse } from "./cors";

const DASHSCOPE_CHAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const ASR_MODEL = "qwen3-asr-flash";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB (qwen3-asr-flash ≤5min audio)

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function mimeFromName(name: string): string {
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".flac")) return "audio/flac";
  return "audio/webm";
}

export async function handleASR(
  request: Request,
  env: ValidatedEnv,
  origin?: string | null,
): Promise<Response> {
  if (request.method !== "POST") {
    return corsResponse(JSON.stringify({ error: "Method not allowed" }), 405, undefined, origin);
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return corsResponse(JSON.stringify({ error: "Expected multipart/form-data" }), 400, undefined, origin);
    }

    const formData = await request.formData();
    const audioFile = formData.get("file") as File | null;
    if (!audioFile) {
      return corsResponse(JSON.stringify({ error: "Missing 'file' field" }), 400, undefined, origin);
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      return corsResponse(JSON.stringify({ error: "文件过大（最大 5MB）" }), 400, undefined, origin);
    }

    // Convert to base64 data URI
    const buffer = await audioFile.arrayBuffer();
    const b64 = arrayBufferToBase64(buffer);
    const mime = audioFile.type || mimeFromName(audioFile.name || "recording.webm");
    const dataUri = `data:${mime};base64,${b64}`;

    console.log("[asr] Sending to qwen3-asr-flash, size:", audioFile.size, "mime:", mime);

    // Call qwen3-asr-flash via chat completions
    const response = await fetch(DASHSCOPE_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ASR_MODEL,
        messages: [{
          role: "user",
          content: [{
            type: "input_audio",
            input_audio: { data: dataUri },
          }],
        }],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[asr] DashScope error:", response.status, errText);
      let errData: Record<string, unknown> = {};
      try { errData = JSON.parse(errText) as Record<string, unknown>; } catch { errData = { error: errText }; }
      return corsResponse(
        JSON.stringify({ error: "语音识别失败", detail: errData }),
        response.status, undefined, origin,
      );
    }

    // Extract text from chat completion response
    const result = await response.json() as Record<string, unknown>;
    const choices = result.choices as Array<{ message?: { content?: string } }> | undefined;
    const text = choices?.[0]?.message?.content || "";

    // Return in the same format as OpenAI transcription API
    return corsResponse(JSON.stringify({ text }), 200, undefined, origin);
  } catch (err) {
    console.error("[asr] Error:", err);
    return corsResponse(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      500, undefined, origin,
    );
  }
}
