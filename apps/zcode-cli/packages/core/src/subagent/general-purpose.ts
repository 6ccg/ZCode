// ============================================================
// General Purpose Subagent Definition
// ============================================================

export const GENERAL_PURPOSE_AGENT_TYPE = "general-purpose" as const;
import { renderBuiltinPrompt, type BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export function buildGeneralPurposeSystemPrompt(overrides?: BuiltinPromptOverrides): string {
  return renderBuiltinPrompt("subagent.generalPurpose", overrides);
}
