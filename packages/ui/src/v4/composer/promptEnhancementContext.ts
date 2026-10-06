const MAX_CONTEXT_MESSAGES = 6;
const MAX_CONTEXT_MESSAGE_CHARS = 1_500;

interface PromptContextRow {
  kind: string;
  text?: string;
  state?: string;
  epilogueStart?: number;
}

/** 只读当前客户端已有的对话窗口，不额外读取历史、工具输出或代码库。 */
export function buildPromptEnhancementConversationContext(
  rows: readonly PromptContextRow[],
): string {
  return rows
    .filter(
      (row) =>
        (row.kind === "userInput" || (row.kind === "assistantText" && row.state === "complete")) &&
        row.text?.trim(),
    )
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((row) => {
      const original =
        row.kind === "userInput" && row.epilogueStart !== undefined
          ? row.text!.slice(0, row.epilogueStart)
          : row.text!;
      const text =
        original.length > MAX_CONTEXT_MESSAGE_CHARS
          ? `${original.slice(0, MAX_CONTEXT_MESSAGE_CHARS)}\n[truncated]`
          : original;
      return `${row.kind === "userInput" ? "User" : "Assistant"}:\n${text}`;
    })
    .join("\n\n");
}
