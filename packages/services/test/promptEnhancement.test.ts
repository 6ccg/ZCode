import assert from "node:assert/strict";
import { test } from "node:test";
import { PromptEnhancementGenerator } from "../src/zcode-agent/promptEnhancementGenerator.js";
import type { ZCodeAgentGenerateWorkspaceTextParams } from "../src/zcode-agent/zcodeAgent.js";

const request = {
  mode: "organize" as const,
  selection: {
    providerId: "example",
    modelId: "text-model",
    options: { reasoningLevel: "low" },
  },
  instruction: "分析错误原因，先不要改代码。",
  protectedContent: [],
  templates: { system: "SYSTEM_MARKER", user: "{{input}}\n{{context}}" },
};

test("enhancement uses the frozen model and templates through the existing generator", async () => {
  let captured: ZCodeAgentGenerateWorkspaceTextParams | undefined;
  const generator = new PromptEnhancementGenerator(async (input) => {
    captured = input;
    return {
      text: "请分析错误的根本原因，暂不修改代码。",
      selection: input.selection,
      finishReason: "stop",
    };
  });
  const result = await generator.generate({
    workspacePath: "/project",
    operationId: "first",
    request,
  });
  assert.equal(result.text, "请分析错误的根本原因，暂不修改代码。");
  assert.deepEqual(captured?.selection, request.selection);
  assert.equal(captured?.querySource, "prompt_enhancement.organize");
  assert.equal(captured?.messages?.[0]?.content, "SYSTEM_MARKER");
  assert.equal(captured?.tools, undefined);
  assert.equal(generator.cancel({ workspacePath: "/project", operationId: "first" }), false);
});

test("serializable cancellation reaches the model signal and releases the operation", async () => {
  let receivedSignal: AbortSignal | undefined;
  const generator = new PromptEnhancementGenerator(async (input) => {
    receivedSignal = input.signal;
    await new Promise<never>((_resolve, reject) => {
      input.signal!.addEventListener("abort", () => reject(input.signal!.reason), { once: true });
    });
    throw new Error("unreachable");
  });
  const pending = generator.generate({
    workspacePath: "/project",
    operationId: "cancel-me",
    request,
  });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  assert.equal(generator.cancel({ workspacePath: "/project", operationId: "cancel-me" }), true);
  assert.equal(receivedSignal?.aborted, true);
  await rejected;
  assert.equal(generator.cancel({ workspacePath: "/project", operationId: "cancel-me" }), false);
});

test("incomplete and empty model output is rejected without a usable replacement", async () => {
  for (const output of [
    { text: "half", finishReason: "length" },
    { text: "  ", finishReason: "stop" },
  ]) {
    const generator = new PromptEnhancementGenerator(async (input) => ({
      ...output,
      selection: input.selection,
    }));
    await assert.rejects(
      generator.generate({ workspacePath: "/project", operationId: "invalid", request }),
      /incomplete|empty/i,
    );
  }
});

test("cancellation releases a pending preflight even before the adapter observes the signal", async () => {
  let resolveLate!: (value: { text: string; selection: typeof request.selection }) => void;
  const generator = new PromptEnhancementGenerator(
    () =>
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
  );
  const pending = generator.generate({
    workspacePath: "/project",
    operationId: "preflight",
    request,
  });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  generator.cancel({ workspacePath: "/project", operationId: "preflight" });
  await rejected;
  assert.equal(generator.cancel({ workspacePath: "/project", operationId: "preflight" }), false);
  resolveLate({ text: "late result", selection: request.selection });
  generator.dispose();
});
