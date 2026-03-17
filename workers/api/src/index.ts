/**
 * Project Resonance API Worker
 *
 * Routes:
 *   POST /cosyvoice-tts         → Text-to-speech via DashScope CosyVoice
 *   POST /cosyvoice-voice-clone → Voice cloning via DashScope + OSS
 *   POST /dashscope-asr         → Audio transcription via DashScope ASR
 */

import type { Env, ValidatedEnv } from "./env";
import { validateEnv } from "./env";
import { handleCORS, corsResponse } from "./cors";
import { handleTTS } from "./cosyvoice-tts";
import { handleClone } from "./cosyvoice-clone";
import { handleASR } from "./dashscope-asr";

function validateAppToken(
  request: Request,
  env: ValidatedEnv,
  origin?: string | null,
): Response | null {
  const expectedToken = env.WORKER_AUTH_SECRET?.trim();
  if (!expectedToken) {
    return null;
  }

  const actualToken = request.headers.get("X-App-Token")?.trim();
  if (actualToken === expectedToken) {
    return null;
  }

  console.warn("[worker] Rejected request with invalid app token");
  return corsResponse(JSON.stringify({ error: "Forbidden" }), 403, undefined, origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      return handleCORS(origin);
    }

    try {
      validateEnv(env);
    } catch (err) {
      console.error("[worker] Env validation failed:", err);
      return corsResponse(JSON.stringify({ error: "Server misconfigured" }), 500, undefined, origin);
    }

    const authError = validateAppToken(request, env, origin);
    if (authError) {
      return authError;
    }

    const url = new URL(request.url);

    switch (url.pathname) {
      case "/cosyvoice-tts":
        return handleTTS(request, env, origin);
      case "/cosyvoice-voice-clone":
        return handleClone(request, env, origin);
      case "/dashscope-asr":
        return handleASR(request, env, origin);
      default:
        return corsResponse(JSON.stringify({ error: "Not found" }), 404, undefined, origin);
    }
  },
} satisfies ExportedHandler<Env>;
