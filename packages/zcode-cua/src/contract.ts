import type { ComputerUseRuntime, ComputerUseRuntimeOptions } from "../index.js";

/** Explicit local-only AX runtime; its backend owns native consent and dispatch. */
export type SourceRuntimeFactory = (options: ComputerUseRuntimeOptions) => ComputerUseRuntime;
