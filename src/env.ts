let globalEnv: any = null;

export function setEnv(env: any) {
  globalEnv = env;
}

export function getEnv() {
  return globalEnv;
}
