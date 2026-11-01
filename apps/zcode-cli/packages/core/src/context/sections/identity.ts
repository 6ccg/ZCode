// ============================================================
// Identity Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import type { OutputStylePromptConfig } from "../types.js";
import { estimateTokens } from "../utils.js";

const DEFAULT_AGENT_IDENTITY =
  "You are an agent working with the user toward their goals, using your own judgment along the way.";

const OUTPUT_STYLE_AGENT_IDENTITY =
  'You are an interactive agent that helps users according to your "Output Style", which describes how you should respond to user queries.';

import {
  SECURITY_NOTICE,
  buildBuiltinHarnessBlock,
  renderBuiltinPrompt,
  type BuiltinPromptOverrides,
} from "@zcode/shared/builtin-prompts";

/** 安全 IMPORTANT 行：交互式身份与工作流子代理身份共用，逐字同一份。 */
export function buildSecurityNotice(): string {
  return SECURITY_NOTICE;
}

/**
 * `# Harness` 块：稳定运行时约束，不属于 output style 可替换的 coding instructions，
 * 也是工作流子代理身份（sections/workflow-actor.ts）逐字复用的那一段。
 */
export function buildHarnessBlock(midConversationSystem = true): string {
  return buildBuiltinHarnessBlock(midConversationSystem);
}

function buildIdentityPrompt(
  outputStyle: OutputStylePromptConfig | undefined,
  midConversationSystem: boolean,
  overrides?: BuiltinPromptOverrides,
): string {
  const intro = outputStyle ? OUTPUT_STYLE_AGENT_IDENTITY : DEFAULT_AGENT_IDENTITY;

  // 无覆盖时沿用新版投递说明；已有自定义正文保持原样。
  return renderBuiltinPrompt("main.identity", overrides, {
    identity_intro: intro,
    harness_block: buildHarnessBlock(midConversationSystem),
  });
}

export function buildIdentitySection(
  outputStyle?: OutputStylePromptConfig,
  midConversationSystem = true,
  overrides?: BuiltinPromptOverrides,
): ContextSection {
  const content = buildIdentityPrompt(outputStyle, midConversationSystem, overrides);

  return {
    name: "Agent Identity",
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
