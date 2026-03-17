/**
 * Project Resonance API Worker
 *
 * Routes:
 *   POST /cosyvoice-tts         → Text-to-speech via DashScope CosyVoice
 *   POST /cosyvoice-voice-clone → Voice cloning via DashScope + OSS
 */

import type { Env } from "./env";
import { handleCORS, corsResponse } from "./cors";
import { handleTTS } from "./cosyvoice-tts";
import { handleClone } from "./cosyvoice-clone";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    const url = new URL(request.url);

    switch (url.pathname) {
      case "/cosyvoice-tts":
        return handleTTS(request, env);
      case "/cosyvoice-voice-clone":
        return handleClone(request, env);
      default:
        return corsResponse(JSON.stringify({ error: "Not found" }), 404);
    }
  },
} satisfies ExportedHandler<Env>;
