// ============================================================
// Explore Subagent Definition
// ============================================================

import type { EnvInfo } from "@zcode/contracts";
import { renderBuiltinPrompt, type BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export const EXPLORE_AGENT_TYPE = "Explore" as const;

export interface ExploreAgentPromptOptions {
  builtinPromptOverrides?: BuiltinPromptOverrides;
  embeddedSearchEnabled?: boolean;
}

export interface LegacyExploreSystemPromptOptions extends ExploreAgentPromptOptions {
  workingDirectory?: string;
  workspaceRoot?: string;
  envInfo?: Pick<EnvInfo, "isGitRepository" | "platform" | "shell" | "osVersion">;
  modelName?: string;
}

export function buildExploreAgentPrompt(options: ExploreAgentPromptOptions): string {
  const searchGuidelines = options.embeddedSearchEnabled
    ? [
        "- Use `find` via Bash for broad file pattern matching",
        "- Use `grep` via Bash for searching file contents with regex",
      ]
    : [
        "- Use Glob for broad file pattern matching",
        "- Use Grep for searching file contents with regex",
      ];
  const bashReadOnlyCommands = options.embeddedSearchEnabled
    ? "ls, git status, git log, git diff, find, grep, cat, head, tail"
    : "ls, git status, git log, git diff, find, cat, head, tail";

  return renderBuiltinPrompt("subagent.explore", options.builtinPromptOverrides, {
    search_guidelines: searchGuidelines.join("\n"),
    bash_read_only_commands: bashReadOnlyCommands,
  });
}

export function buildExploreSystemPrompt(options: LegacyExploreSystemPromptOptions): string {
  return buildExploreAgentPrompt(options);
}
