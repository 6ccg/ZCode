import { externalWindowsCuaFunction } from "./src/external-windows-runtime.js";
export function createPipSessionClient(_options) {
  const external = externalWindowsCuaFunction("./pip-session/node", "createPipSessionClient");
  if (external) return external(...arguments);
  return {
    enabled: false,
    async connect() {},
    async send() {
      return { applied: false };
    },
    close() {},
  };
}
