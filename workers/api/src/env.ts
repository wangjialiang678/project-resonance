export interface Env {
  DASHSCOPE_API_KEY: string;
  OSS_BUCKET: string;
  OSS_ENDPOINT: string;
  OSS_ACCESS_KEY_ID: string;
  OSS_ACCESS_KEY_SECRET: string;
}

const REQUIRED_KEYS: (keyof Env)[] = [
  "DASHSCOPE_API_KEY", "OSS_BUCKET", "OSS_ENDPOINT", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET",
];

export function validateEnv(env: Record<string, unknown>): asserts env is Env {
  const missing = REQUIRED_KEYS.filter(k => !env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
}
