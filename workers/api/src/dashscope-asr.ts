import type { Env } from "./env";
import { corsResponse } from "./cors";

const DASHSCOPE_ASR_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions";
const ASR_MODEL = "paraformer-realtime-v2";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function handleASR(
  request: Request,
  env: Env,
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
      return corsResponse(JSON.stringify({ error: "文件过大（最大 20MB）" }), 400, undefined, origin);
    }

    const upstream = new FormData();
    upstream.append("file", audioFile, audioFile.name || "recording.webm");
    upstream.append("model", ASR_MODEL);

    const response = await fetch(DASHSCOPE_ASR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
      },
      body: upstream,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[asr] DashScope error:", response.status, errText);

      let errData: Record<string, unknown> = {};
      try {
        errData = JSON.parse(errText) as Record<string, unknown>;
      } catch {
        errData = { error: errText };
      }

      return corsResponse(
        JSON.stringify({ error: "语音识别失败", detail: errData }),
        response.status,
        undefined,
        origin,
      );
    }

    const result = await response.text();
    return corsResponse(result, 200, undefined, origin);
  } catch (err) {
    console.error("[asr] Error:", err);
    return corsResponse(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      500,
      undefined,
      origin,
    );
  }
}
