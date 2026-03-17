/**
 * Project Resonance API Worker
 *
 * Routes:
 *   POST /cosyvoice-tts         → Text-to-speech via DashScope CosyVoice
 *   POST /cosyvoice-voice-clone → Voice cloning via DashScope + OSS
 */

import type { Env } from "./env";
import { validateEnv } from "./env";
import { handleCORS, corsResponse } from "./cors";
import { handleTTS } from "./cosyvoice-tts";
import { handleClone } from "./cosyvoice-clone";

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

    const url = new URL(request.url);

    switch (url.pathname) {
      case "/cosyvoice-tts":
        return handleTTS(request, env, origin);
      case "/cosyvoice-voice-clone":
        return handleClone(request, env, origin);
      default:
        return corsResponse(JSON.stringify({ error: "Not found" }), 404, undefined, origin);
    }
  },
} satisfies ExportedHandler<Env>;
