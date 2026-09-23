import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";
import { renderBuiltinPrompt, type BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export function buildDesktopContextSection(overrides?: BuiltinPromptOverrides): ContextSection {
  return createDesktopSection(
    "ZCode Desktop Context",
    "desktop_context",
    renderBuiltinPrompt("main.desktop", overrides),
  );
}

function createDesktopSection(
  name: string,
  source: ContextSection["source"],
  content: string,
): ContextSection {
  return {
    name,
    source,
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
