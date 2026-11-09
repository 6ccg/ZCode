import { createSourceComputerUseRuntime } from "./src/source-runtime.js";
import {
  externalWindowsCuaFunction,
  ExternalWindowsCuaRuntimeError,
} from "./src/external-windows-runtime.js";

const UNAVAILABLE_TEXT = "Computer Use is not available in this build.";

export function createComputerUseRuntime(options = {}) {
  if (options.sourceBackend === "macos-ax") return createSourceComputerUseRuntime(options);
  const create = externalWindowsCuaFunction(".", "createComputerUseRuntime", { env: options.env });
  if (create) {
    // 原生进程仍由 WindowsCuaHelperHost 持有；外部 runtime 只消费既有 broker transport。
    const runtime = create({
      ...options,
      ensureBrokerAvailable: options.ensureBrokerAvailable ?? (async () => {}),
    });
    if (
      !["execute", "closeSession", "dispose"].every((name) => typeof runtime?.[name] === "function")
    ) {
      throw new ExternalWindowsCuaRuntimeError(
        "factory did not return the complete runtime contract",
      );
    }
    return runtime;
  }
  return {
    async execute() {
      return {
        content: [{ type: "text", text: UNAVAILABLE_TEXT }],
        isError: true,
      };
    },
    async closeSession() {},
    async dispose() {},
  };
}
