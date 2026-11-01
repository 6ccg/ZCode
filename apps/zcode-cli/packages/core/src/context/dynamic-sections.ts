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
