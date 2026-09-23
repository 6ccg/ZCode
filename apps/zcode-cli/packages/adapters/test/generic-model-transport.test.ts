import assert from "node:assert/strict";
import test from "node:test";
import { generateText } from "ai";
import { createRegistryProviderConfig, parseProviderConfig } from "@zcode/provider";
import { AiSdkModelExecution } from "../src/model/model-execution.js";

test("official endpoints retain upstream gateway routing while other origins stay direct", async () => {
  for (const [baseUrl, expectedUrl] of [
    [
      "https://api.z.ai/api/anthropic",
      "https://gateway.example/api/v1/ultra-zai/anthropic/v1/messages",
    ],
    [
      "https://open.bigmodel.cn/api/anthropic",
      "https://gateway.example/api/v1/ultra/anthropic/v1/messages",
    ],
    ["https://provider.example/anthropic", "https://provider.example/anthropic/v1/messages"],
  ]) {
    const requests: Array<{ url: string; headers: Headers; body: string }> = [];
    const execution = new AiSdkModelExecution(
      { env: { ZCODE_BASE_URL: "https://gateway.example" } },
      {
        transport: async (input, init) => {
          requests.push({
            url: String(input),
            headers: new Headers(init?.headers),
            body: String(init?.body),
          });
          return new Response(
            JSON.stringify({
              id: "msg_test",
              type: "message",
              role: "assistant",
              model: "test-model",
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
      },
    );
    const config = createRegistryProviderConfig(
      parseProviderConfig({
        group: "standard-personal",
        access: { type: "api-key", apiKey: "test-only-key" },
        api: { type: "anthropic-messages", baseUrl },
      }),
    );
    assert.ok(config.ok);
    const binding = execution.bindModel({
      providerId: "custom-test",
      modelId: "test-model",
      providerConfig: config.config,
      supportsJsonSchemaOutput: false,
      optionSpecs: { reasoningLevel: { map: "{}" }, maxOutputTokens: { map: "{}" } },
    });
    const result = await generateText({
      model: binding.resolved.model,
      prompt: "synthetic test prompt",
      maxRetries: 0,
    });
    assert.equal(result.text, "ok");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, expectedUrl);
    assert.equal(requests[0]!.headers.get("x-api-key"), "test-only-key");
    assert.ok(requests[0]!.body.includes("synthetic test prompt"));
  }
});
