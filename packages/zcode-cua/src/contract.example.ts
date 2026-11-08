import type { SourceRuntimeFactory } from "./contract.js";
export function sourceRuntimeExample(create: SourceRuntimeFactory) {
  return create({ sourceBackend: "macos-ax" });
}
