/**
 * Pages Functions middleware — auth + CORS for all API routes.
 *
 * Runs before every function under functions/.
 * Static assets (HTML/JS/CSS) are served directly by Pages and skip this.
 */

interface Env {
  DASHSCOPE_API_KEY: string;
  OSS_BUCKET: string;
  OSS_ENDPOINT: string;
  OSS_ACCESS_KEY_ID: string;
  OSS_ACCESS_KEY_SECRET: string;
  WORKER_AUTH_SECRET?: string;
}

const ALLOWED_ORIGINS = [
  "https://project-resonance.pages.dev",
  "http://localhost:8080",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// API paths that require auth + CORS
const API_PATHS = ["/dashscope-asr", "/cosyvoice-tts", "/cosyvoice-voice-clone"];

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  // Only apply auth + CORS to API paths; let static assets through
  if (!API_PATHS.includes(url.pathname)) {
    return context.next();
  }

  const origin = context.request.headers.get("origin");

  // CORS preflight
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Auth check
  const secret = context.env.WORKER_AUTH_SECRET?.trim();
  if (secret) {
    const token = context.request.headers.get("X-App-Token")?.trim();
    if (token !== secret) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }
  }

  // Run the actual function
  const response = await context.next();

  // Add CORS headers to response
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    newHeaders.set(k, v);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};
