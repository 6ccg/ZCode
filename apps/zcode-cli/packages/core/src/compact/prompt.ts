import { renderBuiltinPrompt, type BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export function buildCompactPrompt(
  customInstructions: string | undefined,
  overrides?: BuiltinPromptOverrides,
): string {
  const customInstructionBlock = customInstructions?.trim()
    ? `\n\nAdditional Instructions:\n${customInstructions}`
    : "";

  return renderBuiltinPrompt("auxiliary.compact", overrides, {
    custom_instructions: customInstructionBlock,
  });
}

export function formatCompactSummary(text: string | undefined): string {
  let formatted = text?.trim() ?? "";
  if (!formatted) return "";

  formatted = formatted.replace(/<analysis>[\s\S]*?<\/analysis>/, "");
  const summaryMatch = formatted.match(/<summary>([\s\S]*?)<\/summary>/);
  if (summaryMatch) {
    const summary = summaryMatch[1] || "";
    formatted = formatted.replace(/<summary>[\s\S]*?<\/summary>/, `Summary:\n${summary.trim()}`);
  }

  return formatted.replace(/\n\n+/g, "\n\n").trim();
}

export function buildCompactSummaryMessage(
  summary: string,
  options: {
    recentMessagesPreserved?: boolean;
    replStateCleared?: boolean;
    suppressFollowup?: boolean;
    transcriptPath?: string;
  } = {},
): string {
  let message = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${formatCompactSummary(summary)}`;

  if (options.transcriptPath) {
    message += `\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${options.transcriptPath}`;
  }

  if (options.recentMessagesPreserved) {
    message += "\n\nRecent messages are preserved verbatim.";
  }

  if (options.replStateCleared) {
    message +=
      "\n\nYour REPL VM state has been cleared as part of this compaction. Variables defined in REPL calls before this point are no longer accessible — redefine any you still need.";
  }

  if (options.suppressFollowup) {
    message +=
      '\nContinue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I\'ll continue" or similar. Pick up the last task as if the break never happened.';
  }

  return message;
}
