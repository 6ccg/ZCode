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
    // 修复原因：替换串是模板字符串时，摘要里的 $' $$ $& 会被当成替换语法，文本被改写。
    // 用回调返回替换文本，内容原样保留。
    formatted = formatted.replace(
      /<summary>[\s\S]*?<\/summary>/,
      () => `Summary:\n${summary.trim()}`,
    );
  }

  return formatted.replace(/\n\n+/g, "\n\n").trim();
}

// 保留段非空时追加在摘要消息最后，提醒模型摘要之后的原文比摘要更新。
const PRESERVED_MESSAGES_NOTE =
  "The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.";

/**
 * `formattedSummary` 是 formatCompactSummary 的结果。
 * 修复原因：调用方已格式化一次，这里再格式化会把摘要正文里的 `<summary>` 标签再处理一遍，
 * 模型看到的文本与持久化的摘要不同；摘要只格式化一次。
 */
export function buildCompactSummaryMessage(
  formattedSummary: string,
  options: {
    preservedMessagesKept?: boolean;
    replStateCleared?: boolean;
    suppressFollowup?: boolean;
    transcriptPath?: string;
  } = {},
): string {
  let message = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${formattedSummary}`;

  if (options.transcriptPath) {
    message += `\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${options.transcriptPath}`;
  }

  if (options.replStateCleared) {
    message +=
      "\n\nYour REPL VM state has been cleared as part of this compaction. Variables defined in REPL calls before this point are no longer accessible — redefine any you still need.";
  }

  if (options.suppressFollowup) {
    message +=
      '\nContinue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I\'ll continue" or similar. Pick up the last task as if the break never happened.';
  }

  if (options.preservedMessagesKept) {
    message += `\n\n${PRESERVED_MESSAGES_NOTE}`;
  }

  return message;
}
