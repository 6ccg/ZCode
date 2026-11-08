import { createSourceComputerUseRuntime } from "./src/source-runtime.js";

const UNAVAILABLE_TEXT = "Computer Use is not available in this build.";

export function createComputerUseRuntime(options = {}) {
  if (options.sourceBackend === "macos-ax") return createSourceComputerUseRuntime(options);
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
