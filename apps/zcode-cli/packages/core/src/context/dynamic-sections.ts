import type { ContextBuilderConfig, ContextSection } from "./types.js";
import { estimateTokens } from "./utils.js";

import { renderBuiltinPrompt, type BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export function buildSessionGuidanceSection(
  toolNames: readonly string[],
  hasSkills = false,
  overrides?: BuiltinPromptOverrides,
): ContextSection | null {
  // 保留原有触发条件，编辑模板不能让不存在的 Skill 能力出现在提示中。
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

export function buildOutputStyleSection(
  style: ContextBuilderConfig["outputStyle"],
): ContextSection | null {
  if (!style || style.prompt.trim().length === 0) return null;
  return createDynamicSection(
    "Output Style",
    "output_style",
    [`# Output Style: ${style.name}`, style.prompt.trim()].join("\n"),
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
