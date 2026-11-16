// ============================================================
// CLI Prefix Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";
import {
  renderBuiltinPromptOverride,
  type BuiltinPromptOverrides,
} from "@zcode/shared/builtin-prompts";

const CLI_PREFIX_PROMPT = "You are ZCode, an interactive agent";

export function buildCliPrefixSection(overrides?: BuiltinPromptOverrides): ContextSection {
  const content = renderBuiltinPromptOverride("main.prefix", overrides) ?? CLI_PREFIX_PROMPT;

  return {
    name: "CLI Prefix",
    source: "cli_prefix",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
