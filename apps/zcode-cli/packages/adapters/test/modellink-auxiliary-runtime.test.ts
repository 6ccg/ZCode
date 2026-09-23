import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import {
  InMemorySessionEventStore,
  createRootTraceContext,
  type ModelInputMessage,
  type ModelToolContract,
} from "@zcode/contracts";
import { AgentRuntime } from "../../core/src/runtime/agent-runtime.js";
import { generateTitleCandidate } from "../../core/src/runtime/methods/title-generation-sidecar.js";
import {
  createRegistryModelConfig,
  createRegistryProviderConfig,
  ModelConfig,
  parseProviderConfig,
  normalizeModelLinkCatalog,
} from "@zcode/provider";
import { AiSdkModelAdapter } from "../src/model/runner.js";

test("runtime sends main, title and Git requests to configured protocols with selected reasoning", async () => {
  const requests: Array<{ path: string; auth: string; body: any }> = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ path: request.url!, auth: request.headers.authorization!, body });
    const responses = request.url!.endsWith("/responses");
    const result: any = responses
      ? {
          id: "resp_test",
          object: "response",
          created_at: 1,
          status: "completed",
          model: body.model,
          output: [
            {
              id: "msg_test",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Test title", annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        }
      : {
          id: "chat_test",
          object: "chat.completion",
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Test title" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        };
    const history = responses ? body.input : body.messages;
    if (
      body.tools?.length &&
      !history.some((item: any) => item.type === "function_call_output" || item.role === "tool")
    ) {
      if (responses)
        result.output = [
          {
            type: "reasoning",
            id: "rs_test",
            summary: [{ type: "summary_text", text: "Inspect the file" }],
          },
          {
            type: "function_call",
            id: "fc_test",
            call_id: "call_test",
            name: "Read",
            arguments: '{"path":"fixture.txt"}',
          },
        ];
      else
        result.choices = [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_test",
                  type: "function",
                  function: { name: "Read", arguments: '{"path":"fixture.txt"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ];
    }
    if (body.stream) {
      response.setHeader("content-type", "text/event-stream");
      const send = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`);
      if (responses) {
        const message = result.output[0];
        send({
          type: "response.created",
          sequence_number: 0,
          response: { ...result, status: "in_progress", output: [] },
        });
        send({
          type: "response.output_item.added",
          sequence_number: 1,
          output_index: 0,
          item: { ...message, status: "in_progress", content: [] },
        });
        send({
          type: "response.content_part.added",
          sequence_number: 2,
          item_id: message.id,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
        send({
          type: "response.output_text.delta",
          sequence_number: 3,
          item_id: message.id,
          output_index: 0,
          content_index: 0,
          delta: "Test title",
        });
        send({
          type: "response.output_item.done",
          sequence_number: 4,
          output_index: 0,
          item: message,
        });
        send({ type: "response.completed", sequence_number: 5, response: result });
      } else {
        send({
          ...result,
          object: "chat.completion.chunk",
          choices: [
            { index: 0, delta: { role: "assistant", content: "Test title" }, finish_reason: null },
          ],
        });
        send({
          ...result,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
        response.write("data: [DONE]\n\n");
      }
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(result));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/custom/v1`;
  const adapter = new AiSdkModelAdapter({ env: {} });
  const main = { providerId: "responses", modelId: "muse", options: { reasoningLevel: "low" } };
  let auxiliary: typeof main | undefined = {
    providerId: "chat",
    modelId: "chat-model",
    options: { reasoningLevel: "high" },
  };
  const modelFactory = ({ selection }: any) => {
    const apiType =
      selection.providerId === "chat" ? "openai-chat-completions" : "openai-responses";
    const protocol = apiType === "openai-responses" ? "responses" : "chat_completions";
    const provider = createRegistryProviderConfig(
      parseProviderConfig({
        group: "standard-personal",
        api: { type: apiType, baseUrl },
        access: { type: "api-key", apiKey: "runtime-test-key" },
      }),
    );
    const catalog = normalizeModelLinkCatalog(
      {
        data: [
          {
            id: selection.modelId,
            modellink: {
              preferred_protocol: protocol,
              protocols: {
                [protocol]: {
                  context_length: 32000,
                  max_completion_tokens: 4096,
                  supports_vision: true,
                  supported_reasoning_efforts: ["low", "high"],
                },
              },
            },
          },
        ],
      },
      apiType,
    );
    const model = createRegistryModelConfig(ModelConfig.fromData(catalog[0]!.config));
    assert.ok(provider.ok && model.ok);
    return adapter.createModel({
      providerId: selection.providerId,
      modelId: selection.modelId,
      providerConfig: provider.config,
      modelConfig: model.config,
      options: selection.options,
    });
  };
  const runtime = new AgentRuntime(
    "test-session" as any,
    { modelSelection: main, titleGeneration: {}, workingDirectory: process.cwd() },
    {
      eventStore: new InMemorySessionEventStore(),
      modelFactory,
      modelCatalogPort: { listModels: () => [], getAuxiliaryModelSelection: () => auxiliary },
    },
  );
  try {
    const mainResult = await runtime.generateWorkspaceText({
      selection: main,
      prompt: "hello",
      querySource: "integration",
      maxOutputTokens: 1024,
    });
    assert.equal(mainResult.text, "Test title");
    const title = await generateTitleCandidate.call(
      runtime as any,
      "Give this test a short title",
      {
        querySource: "session_title",
        traceContext: createRootTraceContext({ sessionId: "test-session" as any }),
      },
    );
    assert.equal(title?.title, "Test title");
    const commit = await runtime.generateWorkspaceText({
      selection: main,
      prompt: "write a commit message",
      querySource: "git_commit_message",
    });
    assert.equal(commit.selection.providerId, "chat");
    assert.deepEqual(
      requests.map((request) => [
        request.path,
        request.body.model,
        request.body.reasoning_effort ?? request.body.reasoning?.effort,
      ]),
      [
        ["/custom/v1/responses", "muse", "low"],
        ["/custom/v1/chat/completions", "chat-model", "high"],
        ["/custom/v1/chat/completions", "chat-model", "high"],
      ],
    );
    assert.ok(requests.every((request) => request.auth === "Bearer runtime-test-key"));
    assert.equal(runtime.getSessionModelSelection()?.providerId, "responses");
    auxiliary = { ...auxiliary!, options: { reasoningLevel: "invalid" } };
    await assert.rejects(
      runtime.generateWorkspaceText({
        selection: main,
        prompt: "commit",
        querySource: "git_commit_message",
      }),
      /reasoningLevel/,
    );
    assert.equal(requests.length, 3);
    const tools: ModelToolContract[] = [
      {
        name: "Read",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ];
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9KsAAAAASUVORK5CYII=";
    const messages: ModelInputMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Read the fixture" },
          { type: "image", mediaType: "image/png", dataUrl: image },
        ],
      },
    ];
    for (const selection of [
      main,
      { providerId: "chat", modelId: "chat-model", options: { reasoningLevel: "high" } },
    ]) {
      const model = modelFactory({ selection }).bind({ maxOutputTokens: 1024 });
      const first = await model.generateText({ messages, tools });
      assert.deepEqual(
        first.toolCalls?.map((call) => [call.id, call.name, call.input]),
        [["call_test", "Read", { path: "fixture.txt" }]],
      );
      const wire = requests.at(-1)!.body;
      if (selection.providerId === "responses") {
        assert.ok(
          wire.input.some((item: any) =>
            item.content?.some(
              (part: any) => part.type === "input_image" && part.image_url === image,
            ),
          ),
        );
      } else {
        assert.ok(
          wire.messages.some(
            (item: any) =>
              Array.isArray(item.content) &&
              item.content.some(
                (part: any) => part.type === "image_url" && part.image_url.url === image,
              ),
          ),
        );
      }
      assert.ok(JSON.stringify(wire).includes("Read"));
      const next = await model.generateText({
        tools,
        messages: [
          ...messages,
          { role: "assistant", content: first.reasoning ?? "", toolCalls: first.toolCalls },
          { role: "tool", content: "fixture contents", toolCallId: "call_test", toolName: "Read" },
        ],
      });
      assert.equal(next.text, "Test title");
      const continuation = requests.at(-1)!.body;
      if (selection.providerId === "responses") {
        assert.ok(
          continuation.input.some(
            (item: any) => item.type === "function_call_output" && item.call_id === "call_test",
          ),
        );
        assert.equal(continuation.reasoning.effort, "low");
      } else
        assert.ok(
          continuation.messages.some(
            (item: any) => item.role === "tool" && item.tool_call_id === "call_test",
          ),
        );
      const events = [];
      for await (const event of model.streamText({
        messages: [{ role: "user", content: "stream a title" }],
      }))
        events.push(event);
      assert.equal(
        events
          .filter((event) => event.type === "text_delta")
          .map((event) => event.text)
          .join(""),
        "Test title",
      );
      assert.ok(events.some((event) => event.type === "finish"));
      assert.ok(!events.some((event) => event.type === "error"));
    }
  } finally {
    runtime.beginShutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
