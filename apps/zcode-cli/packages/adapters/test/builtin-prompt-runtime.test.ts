import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "vitest";
import { InMemorySessionEventStore, createRootTraceContext } from "@zcode/contracts";
import {
  createRegistryModelConfig,
  createRegistryProviderConfig,
  ModelConfig,
  parseProviderConfig,
  normalizeModelLinkCatalog,
} from "@zcode/provider";
import {
  getBuiltinPrompt,
  type BuiltinPromptId,
  type BuiltinPromptOverrides,
} from "@zcode/shared/builtin-prompts";
import { AgentRuntime } from "../../core/src/runtime/agent-runtime.js";
import { generateTitleCandidate } from "../../core/src/runtime/methods/title-generation-sidecar.js";
import { buildCompactPrompt } from "../../core/src/compact/prompt.js";
import {
  buildContextManagementSection,
  buildDynamicBehaviorSection,
  buildSessionGuidanceSection,
} from "../../core/src/context/dynamic-sections.js";
import { buildCliPrefixSection } from "../../core/src/context/sections/cli-prefix.js";
import { buildDesktopContextContent } from "../../core/src/context/sections/desktop.js";
import { buildIdentitySection } from "../../core/src/context/sections/identity.js";
import { buildMemorySection } from "../../core/src/context/sections/memory.js";
import { buildMemoryExtractionPrompt } from "../../core/src/memory/extraction.js";
import { buildExploreAgentPrompt } from "../../core/src/subagent/explore.js";
import { buildGeneralPurposeSystemPrompt } from "../../core/src/subagent/general-purpose.js";
import { AiSdkModelAdapter } from "../src/model/runner.js";

// 上游调用点保留原文，覆盖只做短路；设置页默认值来自共享模板。
// 把共享默认模板当作覆盖传入时必须逐字还原上游输出，否则说明 rebase 后上游文案已变，需要同步默认模板。
test("shared built-in prompt defaults match upstream prompt text", () => {
  const asOverride = (id: BuiltinPromptId): BuiltinPromptOverrides => ({
    [id]: getBuiltinPrompt(id).template,
  });
  const cases: Array<
    [BuiltinPromptId, (overrides?: BuiltinPromptOverrides) => string | undefined]
  > = [
    ["main.prefix", (o) => buildCliPrefixSection(o).content],
    ["main.identity", (o) => buildIdentitySection(undefined, true, o).content],
    ["main.identity", (o) => buildIdentitySection({} as never, false, o).content],
    ["main.behavior", (o) => buildDynamicBehaviorSection(o).content],
    ["main.contextManagement", (o) => buildContextManagementSection(o).content],
    ["main.sessionGuidance", (o) => buildSessionGuidanceSection(["Skill"], true, o)?.content],
    ["main.desktop", (o) => buildDesktopContextContent(true, o)],
    ["main.desktop", (o) => buildDesktopContextContent(false, o)],
    ["main.memory", (o) => buildMemorySection("/mem", "default-index", o)?.content],
    ["main.memory", (o) => buildMemorySection("/mem", "semantic-recall", o)?.content],
    ["auxiliary.compact", (o) => buildCompactPrompt("Focus on tests", o)],
    ["auxiliary.compact", (o) => buildCompactPrompt(undefined, o)],
    [
      "auxiliary.memoryExtraction",
      (o) =>
        buildMemoryExtractionPrompt({ builtinPromptOverrides: o, manifest: [], messageCount: 7 }),
    ],
    ["subagent.explore", (o) => buildExploreAgentPrompt({ builtinPromptOverrides: o })],
    [
      "subagent.explore",
      (o) => buildExploreAgentPrompt({ builtinPromptOverrides: o, embeddedSearchEnabled: true }),
    ],
    ["subagent.generalPurpose", (o) => buildGeneralPurposeSystemPrompt(o)],
  ];
  for (const [id, build] of cases) {
    const upstream = build();
    assert.ok(upstream, `${id} upstream output`);
    assert.equal(build(asOverride(id)), upstream, `${id} default template drifted from upstream`);
  }
});

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
      "main.desktop": "DESKTOP_OLD {{gen_ui_instructions}}",
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
          presentationSurface: "zcode_desktop",
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
      const desktopRequest = requests.find((body) =>
        JSON.stringify(body.messages).includes("DESKTOP_OLD"),
      );
      assert.ok(desktopRequest, "desktop override reaches the actual model request");
      assert.ok(
        !JSON.stringify(desktopRequest.messages.filter((m: any) => m.role === "system")).includes(
          "DESKTOP_OLD",
        ),
        "desktop instructions remain in environment announcements",
      );
      overrides = {
        ...overrides,
        "main.behavior": "MAIN_NEW",
        "main.desktop": "DESKTOP_NEW {{gen_ui_instructions}}",
        "auxiliary.title": "TITLE_NEW",
      };
      await runtime.executeTurn("Continue without tools");
      assert.ok(JSON.stringify(requests.at(-1).messages).includes("MAIN_OLD"));
      assert.ok(!JSON.stringify(requests.at(-1).messages).includes("MAIN_NEW"));
      assert.ok(!JSON.stringify(requests.at(-1).messages).includes("DESKTOP_NEW"));
      const title = await generateTitleCandidate.call(runtime as any, "An input query", {
        querySource: "session_title",
        traceContext: createRootTraceContext({ sessionId: "prompts-session" as any }),
      });
      assert.equal(title?.title, "Prompt test");
      assert.equal(requests.at(-1).messages[0].content, "TITLE_NEW");
      next = await createRuntime("next-session");
      await next.executeTurn("New session");
      assert.ok(JSON.stringify(requests.at(-1).messages).includes("MAIN_NEW"));
      assert.ok(JSON.stringify(requests.at(-1).messages).includes("DESKTOP_NEW"));
      delete overrides["auxiliary.title"];
      await generateTitleCandidate.call(runtime as any, "An input query", {
        querySource: "goal_summary_title",
        traceContext: createRootTraceContext({ sessionId: "prompts-session" as any }),
      });
      // 无覆盖时走上游原文，同时校验标题默认模板未漂移。
      assert.equal(
        requests.at(-1).messages[0].content,
        getBuiltinPrompt("auxiliary.title").template,
      );
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
