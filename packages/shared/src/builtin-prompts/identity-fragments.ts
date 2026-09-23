// 工作流身份与主 Agent 默认身份共用，不受主 Agent 覆盖影响。
export const SECURITY_NOTICE =
  "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";
export function buildBuiltinHarnessBlock(midConversationSystem = true): string {
  // 第三条描述动态上下文的真实送达通道：不走 MCS 时这些内容包在 user 的
  // `<system-reminder>` 里，继续声称 "mid-conversation system turns" 会与请求体矛盾。
  const deliveryNotice = midConversationSystem
    ? "The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results."
    : "`<system-reminder>` tags in messages and tool results are injected by the harness, not the user.";
  return [
    "# Harness",
    " - Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
    " - Tools run behind a user-selected permission mode; a denied call means the user declined it \u2014 adjust, don't retry verbatim.",
    ` - ${deliveryNotice} Hooks may intercept tool calls; treat hook output as user feedback.`,
    " - Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
    " - Reference code as `file_path:line_number` \u2014 it's clickable.",
  ].join("\n");
}

export const HARNESS_BLOCK = buildBuiltinHarnessBlock();
