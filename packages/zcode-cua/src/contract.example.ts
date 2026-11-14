import type { BundledRuntimeFactory } from "./contract.js";
export function bundledRuntimeExample(create: BundledRuntimeFactory, brokerSocketPath: string) {
  return create({ brokerSocketPath });
}
