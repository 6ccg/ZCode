// ============================================================
// Identity Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import type { OutputStylePromptConfig } from "../types.js";
import { estimateTokens } from "../utils.js";

import {
  SECURITY_NOTICE,
  HARNESS_BLOCK,
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
export function buildHarnessBlock(): string {
  return HARNESS_BLOCK;
}

function buildIdentityPrompt(
  outputStyle?: OutputStylePromptConfig,
  overrides?: BuiltinPromptOverrides,
): string {
  const intro = outputStyle
    ? "You respond to the user according to the active Output Style below while using ZCode's tools and instructions."
    : "You are an interactive ZCode agent that helps users with software engineering tasks.";

  return renderBuiltinPrompt("main.identity", overrides, { identity_intro: intro });
}

export function buildIdentitySection(
  outputStyle?: OutputStylePromptConfig,
  overrides?: BuiltinPromptOverrides,
): ContextSection {
  const content = buildIdentityPrompt(outputStyle, overrides);

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
