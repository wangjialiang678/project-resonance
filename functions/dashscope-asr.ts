/**
 * DashScope ASR — Pages Function
 *
 * POST /dashscope-asr
 * Body: multipart/form-data with 'file' field
 * Returns: { text: string }
 */

interface Env {
  DASHSCOPE_API_KEY: string;
}

const DASHSCOPE_CHAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const ASR_MODEL = "qwen3-asr-flash";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function mimeFromName(name: string): string {
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".mp4")) return "audio/mp4";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".flac")) return "audio/flac";
  return "audio/webm";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return new Response(JSON.stringify({ error: "Expected multipart/form-data" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const formData = await request.formData();
    const audioFile = formData.get("file") as File | null;
    if (!audioFile) {
      return new Response(JSON.stringify({ error: "Missing 'file' field" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: "文件过大（最大 5MB）" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const buffer = await audioFile.arrayBuffer();
    const b64 = arrayBufferToBase64(buffer);
    const mime = audioFile.type || mimeFromName(audioFile.name || "recording.webm");
    const dataUri = `data:${mime};base64,${b64}`;

    console.log("[asr] Sending to qwen3-asr-flash, size:", audioFile.size, "mime:", mime);

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
          content: [{ type: "input_audio", input_audio: { data: dataUri } }],
        }],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[asr] DashScope error:", response.status, errText);
      let errData: Record<string, unknown> = {};
      try { errData = JSON.parse(errText) as Record<string, unknown>; } catch { errData = { error: errText }; }
      return new Response(
        JSON.stringify({ error: "语音识别失败", detail: errData }),
        { status: response.status, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await response.json() as Record<string, unknown>;
    const choices = result.choices as Array<{ message?: { content?: string } }> | undefined;
    const text = choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[asr] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
