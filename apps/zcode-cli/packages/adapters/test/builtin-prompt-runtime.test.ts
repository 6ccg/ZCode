import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { InMemorySessionEventStore, createRootTraceContext } from "@zcode/contracts";
import {
  createRegistryModelConfig,
  createRegistryProviderConfig,
  ModelConfig,
  parseProviderConfig,
  normalizeModelLinkCatalog,
} from "@zcode/provider";
import type { BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";
import { AgentRuntime } from "../../core/src/runtime/agent-runtime.js";
import { generateTitleCandidate } from "../../core/src/runtime/methods/title-generation-sidecar.js";
import { AiSdkModelAdapter } from "../src/model/runner.js";

test(
  "actual model requests use session prompt snapshots, built-in subagent overrides and fresh auxiliary prompts",
  { timeout: 30_000 },
  async () => {
    const requests: any[] = [];
    let completionText = '{"title":"Prompt test"}';
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(body);
      const shouldSpawn =
        body.tools?.some((tool: any) => tool.function?.name === "Agent") &&
        !body.messages.some((message: any) => message.role === "tool") &&
        body.messages.some(
          (message: any) =>
            message.role === "user" && JSON.stringify(message.content).includes("SPAWN_BOTH"),
        );
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "chat_test",
          object: "chat.completion",
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              message: shouldSpawn
                ? {
                    role: "assistant",
                    content: null,
                    tool_calls: ["general-purpose", "Explore"].map((name, index) => ({
                      id: `agent_${index}`,
                      type: "function",
                      function: {
                        name: "Agent",
                        arguments: JSON.stringify({
                          description: "Test prompt snapshot",
                          prompt: "Report CHILD_OK without tools",
                          subagent_type: name,
                        }),
                      },
                    })),
                  }
                : { role: "assistant", content: completionText },
              finish_reason: shouldSpawn ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const provider = createRegistryProviderConfig(
      parseProviderConfig({
        group: "standard-personal",
        api: { type: "openai-chat-completions", baseUrl: `http://127.0.0.1:${address.port}/v1` },
        access: { type: "api-key", apiKey: "test-key" },
      }),
    );
    const catalog = normalizeModelLinkCatalog(
      {
        data: [
          {
            id: "test",
            modellink: {
              preferred_protocol: "chat_completions",
              protocols: {
                chat_completions: {
                  context_length: 32000,
                  max_completion_tokens: 4096,
                  supported_reasoning_efforts: ["none"],
                },
              },
            },
          },
        ],
      },
      "openai-chat-completions",
    );
    const model = createRegistryModelConfig(ModelConfig.fromData(catalog[0]!.config));
    assert.ok(provider.ok && model.ok);
    const adapter = new AiSdkModelAdapter({ env: {} });
    let overrides: BuiltinPromptOverrides = {
      "main.behavior": "MAIN_OLD",
      "subagent.generalPurpose": "GENERAL_MARKER",
      "subagent.explore": "EXPLORE_MARKER {{search_guidelines}} {{bash_read_only_commands}}",
      "auxiliary.title": "TITLE_OLD",
    };
    const source = {
      async readOverrides() {
        return { ...overrides };
      },
    };
    const selection = { providerId: "test", modelId: "test", options: { reasoningLevel: "none" } };
    const createRuntime = async (id: string) =>
      new AgentRuntime(
        id as any,
        {
          modelSelection: selection,
          workingDirectory: process.cwd(),
          mode: "yolo",
          titleGeneration: { enabled: false },
          memory: { enabled: false },
          mcp: { enabled: false },
          builtinPromptOverrides: await source.readOverrides(),
        },
        {
          eventStore: new InMemorySessionEventStore(),
          builtinPromptSource: source,
          modelFactory: () =>
            adapter.createModel({
              providerId: "test",
              modelId: "test",
              providerConfig: provider.config,
              modelConfig: model.config,
              options: selection.options,
            }),
        },
      );
    const runtime = await createRuntime("prompts-session");
    let next: AgentRuntime | undefined;
    try {
      const first = await runtime.executeTurn("SPAWN_BOTH");
      assert.ok(first, "main turn completed");
      const systems = requests.map((body) =>
        JSON.stringify(body.messages.filter((m: any) => m.role === "system")),
      );
      assert.ok(
        systems.some((text) => text.includes("MAIN_OLD")),
        JSON.stringify(
          requests.flatMap((body) => body.messages.filter((m: any) => m.role === "tool")),
        ),
      );
      assert.ok(
        systems.some((text) => text.includes("GENERAL_MARKER")),
        JSON.stringify(
          requests.flatMap((body) => body.messages.filter((m: any) => m.role === "tool")),
        ),
      );
      assert.ok(
        systems.some((text) => text.includes("EXPLORE_MARKER")),
        JSON.stringify(
          requests.flatMap((body) => body.messages.filter((m: any) => m.role === "tool")),
        ),
      );
      overrides = { ...overrides, "main.behavior": "MAIN_NEW", "auxiliary.title": "TITLE_NEW" };
      await runtime.executeTurn("Continue without tools");
      assert.ok(JSON.stringify(requests.at(-1).messages).includes("MAIN_OLD"));
      assert.ok(!JSON.stringify(requests.at(-1).messages).includes("MAIN_NEW"));
      const title = await generateTitleCandidate.call(runtime as any, "An input query", {
        querySource: "session_title",
        traceContext: createRootTraceContext({ sessionId: "prompts-session" as any }),
      });
      assert.equal(title?.title, "Prompt test");
      assert.equal(requests.at(-1).messages[0].content, "TITLE_NEW");
      next = await createRuntime("next-session");
      await next.executeTurn("New session");
      assert.ok(JSON.stringify(requests.at(-1).messages).includes("MAIN_NEW"));
      delete overrides["auxiliary.title"];
      await generateTitleCandidate.call(runtime as any, "An input query", {
        querySource: "goal_summary_title",
        traceContext: createRootTraceContext({ sessionId: "prompts-session" as any }),
      });
      assert.ok(requests.at(-1).messages[0].content.startsWith("Generate a concise title"));
      completionText = "   ";
      const emptyTitle = await generateTitleCandidate.call(runtime as any, "Empty response", {
        querySource: "session_title",
        traceContext: createRootTraceContext({ sessionId: "prompts-session" as any }),
      });
      assert.equal(emptyTitle, null);
    } finally {
      runtime.beginShutdown();
      next?.beginShutdown();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
