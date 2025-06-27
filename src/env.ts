// Global environment variable storage for Cloudflare Workers
let globalEnv: any = null;

export function setEnv(env: any) {
  globalEnv = env;
}

export function getEnv() {
  if (!globalEnv) {
    throw new Error('Environment not initialized. Make sure setEnv() is called first.');
  }
  return globalEnv;
}

// Optional: Type-safe getter for specific env vars
export function getGoogleAccessToken(): string {
  const env = getEnv();
  if (!env.GOOGLE_ACCESS_TOKEN) {
    throw new Error('GOOGLE_ACCESS_TOKEN not found in environment variables');
  }
  return env.GOOGLE_ACCESS_TOKEN;
}
