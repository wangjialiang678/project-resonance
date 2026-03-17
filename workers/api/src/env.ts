export interface Env {
  DASHSCOPE_API_KEY?: string;
  OSS_BUCKET?: string;
  OSS_ENDPOINT?: string;
  OSS_ACCESS_KEY_ID?: string;
  OSS_ACCESS_KEY_SECRET?: string;
  WORKER_AUTH_SECRET?: string;
}

type RequiredEnvKey =
  | "DASHSCOPE_API_KEY"
  | "OSS_BUCKET"
  | "OSS_ENDPOINT"
  | "OSS_ACCESS_KEY_ID"
  | "OSS_ACCESS_KEY_SECRET";

export type ValidatedEnv = Env & { [K in RequiredEnvKey]-?: string };

const REQUIRED_KEYS: RequiredEnvKey[] = [
  "DASHSCOPE_API_KEY",
  "OSS_BUCKET",
  "OSS_ENDPOINT",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
];

export function validateEnv(env: Env): asserts env is ValidatedEnv {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}
