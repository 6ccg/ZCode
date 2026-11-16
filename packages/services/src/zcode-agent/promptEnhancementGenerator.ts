import {
  buildPromptEnhancementMessages,
  promptEnhancementInputSchema,
  type ZCodeWorkspaceGenerateTextResult,
} from "@zcode/shared";
import type {
  ZCodeAgentCancelPromptEnhancementParams,
  ZCodeAgentEnhancePromptParams,
  ZCodeAgentGenerateWorkspaceTextParams,
  ZCodeAgentWorkspaceTarget,
} from "./zcodeAgent.js";

const ENHANCEMENT_TIMEOUT_MS = 90_000;
const ENHANCEMENT_CANCEL_BUFFER_MS = 5_000;
const INCOMPLETE_FINISH_REASONS = new Set([
  "length",
  "max_tokens",
  "tool-calls",
  "tool_calls",
  "content-filter",
  "content_filter",
  "error",
]);

type TextGenerator = (
  input: ZCodeAgentGenerateWorkspaceTextParams,
) => Promise<ZCodeWorkspaceGenerateTextResult>;

interface Operation {
  controller: AbortController;
  workspaceKey: string;
  remoteSessionId?: string;
}

/** 仅管理正在生成的辅助请求，不拥有 Composer 草稿或正式会话队列。 */
export class PromptEnhancementGenerator {
  readonly #operations = new Map<string, Operation>();
  #disposed = false;
  constructor(private readonly generateText: TextGenerator) {}

  async generate(params: ZCodeAgentEnhancePromptParams): Promise<ZCodeWorkspaceGenerateTextResult> {
    if (this.#disposed) throw new Error("Prompt enhancement host is disposed");
    if (!params.operationId.trim()) throw new Error("Enhancement operation ID is empty");
    if (this.#operations.has(params.operationId))
      throw new Error("Enhancement operation already exists");
    const request = promptEnhancementInputSchema.parse(params.request);
    const operation: Operation = {
      controller: new AbortController(),
      workspaceKey: workspaceKey(params),
      remoteSessionId: params.remoteSessionId,
    };
    this.#operations.set(params.operationId, operation);
    const signal = AbortSignal.any([
      operation.controller.signal,
      AbortSignal.timeout(ENHANCEMENT_TIMEOUT_MS),
    ]);
    try {
      const pending = this.generateText({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
        selection: request.selection,
        messages: buildPromptEnhancementMessages(request),
        querySource: `prompt_enhancement.${request.mode}`,
        signal,
        requestTimeoutMs: ENHANCEMENT_TIMEOUT_MS + ENHANCEMENT_CANCEL_BUFFER_MS,
      });
      const result = await waitForResult(pending, signal);
      // 有些兼容端点在 abort 后仍返回正文；取消后的响应不能再成为可用结果。
      signal.throwIfAborted();
      if (
        (result.finishReason && INCOMPLETE_FINISH_REASONS.has(result.finishReason)) ||
        result.toolCalls?.length
      ) {
        throw new Error("Prompt enhancement response is incomplete");
      }
      if (!result.text.trim()) throw new Error("Prompt enhancement response is empty");
      return result;
    } finally {
      this.#operations.delete(params.operationId);
    }
  }

  cancel(params: ZCodeAgentCancelPromptEnhancementParams): boolean {
    const operation = this.#operations.get(params.operationId);
    if (
      !operation ||
      operation.workspaceKey !== workspaceKey(params) ||
      operation.remoteSessionId !== params.remoteSessionId
    )
      return false;
    operation.controller.abort();
    return true;
  }

  disposeWorkspace(params: ZCodeAgentWorkspaceTarget): void {
    const key = workspaceKey(params);
    for (const operation of this.#operations.values()) {
      if (operation.workspaceKey === key) operation.controller.abort();
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const operation of this.#operations.values()) operation.controller.abort();
    this.#operations.clear();
  }
}

/** 启动／账号同步阶段也可能等待；取消不能等到这两个阶段完成才释放本次请求。 */
function waitForResult<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
    if (signal.aborted) aborted();
  });
}

function workspaceKey(params: ZCodeAgentWorkspaceTarget): string {
  return params.workspaceIdentity?.trim() || params.workspacePath;
}
