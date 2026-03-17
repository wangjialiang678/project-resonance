const ALLOWED_ORIGINS = [
  "https://project-resonance.pages.dev",
  "http://localhost:8080",
  "http://localhost:5173",
];

function getAllowedOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return ALLOWED_ORIGINS[0];
}

export function corsHeaders(requestOrigin?: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(requestOrigin ?? null),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function corsResponse(body: string | null, status = 200, extraHeaders?: Record<string, string>, requestOrigin?: string | null): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders(requestOrigin), "Content-Type": "application/json", ...extraHeaders },
  });
}

export function handleCORS(requestOrigin?: string | null): Response {
  return new Response(null, { headers: corsHeaders(requestOrigin) });
}
