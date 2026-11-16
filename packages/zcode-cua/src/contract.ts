import type { ComputerUseRuntime, ComputerUseRuntimeOptions } from "../index.js";

/** Fixed bundled runtime; the existing local Host owns native lifecycle and admission. */
export type BundledRuntimeFactory = (options: ComputerUseRuntimeOptions) => ComputerUseRuntime;
