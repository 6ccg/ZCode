import { TOTAL_TOKENS_SYSTEM_LINE } from "./total-tokens.js";
import type { ContextSection } from "./types.js";
import { estimateTokens } from "./utils.js";
import { renderBuiltinPrompt, type BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export function buildSessionGuidanceSection(
  toolNames: readonly string[],
  hasSkills = false,
  overrides?: BuiltinPromptOverrides,
): ContextSection | null {
  if (!toolNames.includes("Skill") || !hasSkills) return null;
  return createDynamicSection(
    "Session-specific guidance",
    "session_guidance",
    renderBuiltinPrompt("main.sessionGuidance", overrides),
  );
}

export function buildDynamicBehaviorSection(overrides?: BuiltinPromptOverrides): ContextSection {
  return createDynamicSection(
    "Dynamic Behavior",
    "dynamic_behavior",
    renderBuiltinPrompt("main.behavior", overrides),
  );
}

export function buildContextManagementSection(overrides?: BuiltinPromptOverrides): ContextSection {
  return createDynamicSection(
    "Context Management",
    "context_management",
    renderBuiltinPrompt("main.contextManagement", overrides),
  );
}

/** 固定的 token 预算行，是 system 的最后一段；倒数由每次请求的提醒附件表达。 */
export function buildTotalTokensSection(): ContextSection {
  return createDynamicSection("Total Tokens", "total_tokens", TOTAL_TOKENS_SYSTEM_LINE);
}

function createDynamicSection(
  name: string,
  source: ContextSection["source"],
  content: string,
): ContextSection {
  return {
    name,
    source,
    injectionTarget: "system",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
