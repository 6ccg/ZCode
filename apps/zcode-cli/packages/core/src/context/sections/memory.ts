// ============================================================
// Memory Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";
import { renderBuiltinPrompt, type BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export function buildMemorySection(
  memoryRoot: string | undefined,
  overrides?: BuiltinPromptOverrides,
): ContextSection | null {
  if (!memoryRoot) return null;

  const content = renderBuiltinPrompt("main.memory", overrides, { memory_root: memoryRoot });

  return {
    name: "Memory",
    source: "memory",
    injectionTarget: "system",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
