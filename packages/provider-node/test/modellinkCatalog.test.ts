import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  parseProviderConfig,
  ProviderConfigResolver,
  ProviderConfigMap,
  normalizeModelLinkCatalog,
  parseModelConfig,
  extractManualModelConfig,
} from "../../provider/src/index.js";
import { NodeProviderConfigRuntime } from "../src/provider-config-runtime.js";
import { loadModelLinkCatalog } from "../src/modellink-catalog-loader.js";
import { decodeProviderConfigFile } from "../src/provider-config-file-codec.js";
import { providerProvisioningPersonalConfigSchema } from "@zcode/shared";

const bundled = fileURLToPath(
  new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
);
const model = (id: string, protocol: string, context = 32000) => ({
  id,
  modellink: {
    preferred_protocol: protocol,
    protocols: {
      [protocol]: {
        context_length: context,
        max_completion_tokens: 4096,
        supports_vision: true,
        supports_web_search: true,
        supported_reasoning_efforts: ["low", "high"],
        default_reasoning_effort: "high",
      },
    },
  },
});

test("ModelLink catalog partitions protocols and maps actual per-protocol capabilities", () => {
  const response = {
    data: [model("chat-model", "chat_completions"), model("muse-model", "responses")],
  };
  const chat = normalizeModelLinkCatalog(response, "openai-chat-completions");
  const responses = normalizeModelLinkCatalog(response, "openai-responses");
  assert.deepEqual(
    chat.map((m) => m.modelId),
    ["chat-model"],
  );
  assert.deepEqual(
    responses.map((m) => m.modelId),
    ["muse-model"],
  );
  assert.equal(chat[0]!.config.properties?.contextWindow, 32000);
  assert.equal(chat[0]!.defaultReasoningLevel, "high");
  assert.equal(chat[0]!.config.properties?.supportsNativeWebSearch, true);
  assert.equal(chat[0]!.config.properties?.supportsJsonSchemaOutput, true);
  assert.deepEqual(responses[0]!.config.optionSpecs?.reasoningLevel?.values, ["low", "high"]);
  assert.throws(
    () => normalizeModelLinkCatalog({ data: [{ id: "missing-protocol" }] }, "openai-responses"),
    /协议|protocol/,
  );
});

test("missing catalog limits inherit defaults and old null snapshots are normalized on read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-modellink-limits-"));
  const file = join(dir, "provider_config.json");
  const options = {
    zcodeBuiltinFilePath: bundled,
    personalFilePath: file,
    personalPollingIntervalMs: false as const,
  };
  let runtime = new NodeProviderConfigRuntime(options);
  try {
    const { providerId } = await runtime.configService.createPersonalProvider({
      providerName: "ModelLink Chat",
      catalogSource: "modellink",
      initialConfig: parseProviderConfig({
        api: { type: "openai-chat-completions", baseUrl: "http://127.0.0.1:32123/v1" },
        access: { type: "api-key", apiKey: "test-only" },
      }),
    });
    const models = normalizeModelLinkCatalog(
      {
        data: [
          {
            id: "unknown-limits",
            modellink: {
              preferred_protocol: "chat_completions",
              protocols: { chat_completions: {} },
            },
          },
          model("known-limits", "chat_completions"),
        ],
      },
      "openai-chat-completions",
    );
    assert.equal(models[0]!.config.optionSpecs?.maxOutputTokens?.max, undefined);
    assert.equal(models[0]!.config.properties?.contextWindow, undefined);
    await runtime.configService.saveModelCatalog(
      providerId,
      models,
      (await runtime.personalRepository.read()).revision,
    );
    const resolveModels = async () =>
      new ProviderConfigResolver()
        .resolve({
          ...(await runtime.configService.read()),
          accountProviders: ProviderConfigMap.empty(),
        })
        .registryProviders.find((provider) => provider.providerId === providerId)!.models;
    const available = await resolveModels();
    assert.deepEqual(
      available.map((item) => item.modelId),
      ["unknown-limits", "known-limits"],
    );
    assert.equal(available[0]!.config.optionSpecs.maxOutputTokens.max, 32000);
    assert.equal(available[0]!.config.properties.contextWindow, 200000);
    assert.equal(available[1]!.config.optionSpecs.maxOutputTokens.max, 4096);

    runtime.dispose();
    const saved = JSON.parse(await readFile(file, "utf8"));
    const oldConfig = saved.config.modelCatalogs[providerId].models[0].config;
    oldConfig.optionSpecs.maxOutputTokens.max = null;
    oldConfig.properties.contextWindow = null;
    await writeFile(file, JSON.stringify(saved));
    runtime = new NodeProviderConfigRuntime(options);
    assert.equal((await resolveModels()).length, 2);
    const canonical = JSON.parse(await readFile(file, "utf8"));
    const restored = canonical.config.modelCatalogs[providerId].models[0].config;
    assert.equal("max" in restored.optionSpecs.maxOutputTokens, false);
    assert.equal("contextWindow" in restored.properties, false);
  } finally {
    runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("catalog refresh deletes upstream removals and preserves manual models and retained overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-modellink-removal-"));
  const file = join(dir, "provider_config.json");
  const options = {
    zcodeBuiltinFilePath: bundled,
    personalFilePath: file,
    personalPollingIntervalMs: false as const,
  };
  let runtime = new NodeProviderConfigRuntime(options);
  try {
    const { providerId } = await runtime.configService.createPersonalProvider({
      catalogSource: "modellink",
      initialConfig: parseProviderConfig({
        api: { type: "openai-chat-completions", baseUrl: "http://127.0.0.1:32123/v1" },
        access: { type: "api-key", apiKey: "test-only" },
      }),
    });
    const refresh = async (data: unknown, status = 200) => {
      const before = await runtime.personalRepository.read();
      const models = await loadModelLinkCatalog(before.providers.get(providerId)!, async () =>
        Response.json(data, { status }),
      );
      await runtime.configService.saveModelCatalog(providerId, models, before.revision);
    };
    const catalog = (...ids: string[]) => ({
      data: ids.map((id) => model(id, "chat_completions")),
    });
    const assertModelIds = async (expected: string[]) => {
      const snapshot = await runtime.configService.read();
      const resolved = new ProviderConfigResolver().resolve({
        ...snapshot,
        accountProviders: ProviderConfigMap.empty(),
      });
      assert.deepEqual(
        resolved.resolvedProviders
          .find((provider) => provider.providerId === providerId)!
          .models.map((item) => item.modelId),
        expected,
      );
      assert.deepEqual(
        resolved.registryProviders
          .find((provider) => provider.providerId === providerId)!
          .models.map((item) => item.modelId),
        expected,
      );
    };
    await refresh(catalog("nex-2.5-pro", "remaining-model", "manual-model"));
    await runtime.configService.detachCatalogModel(providerId, "manual-model");
    for (const id of ["nex-2.5-pro", "remaining-model"]) {
      await runtime.configService.savePersonalModelDraft(
        providerId,
        id,
        id,
        parseModelConfig({ properties: { contextWindow: 8192 } }),
        (await runtime.personalRepository.read()).revision,
        true,
      );
    }
    await runtime.configService.reorderPersonalModels(providerId, [
      "nex-2.5-pro",
      "remaining-model",
      "manual-model",
    ]);
    const beforeFailure = await readFile(file, "utf8");
    await assert.rejects(refresh(catalog(), 503), /503/);
    await assert.rejects(refresh({ data: [{ id: "remaining-model" }] }), /协议|protocol/);
    assert.equal(await readFile(file, "utf8"), beforeFailure);

    await refresh(catalog("remaining-model"));
    await assertModelIds(["remaining-model", "manual-model"]);
    const saved = await runtime.personalRepository.read();
    assert.deepEqual(
      saved.modelCatalogs?.[providerId]?.models.map((item) => item.modelId),
      ["remaining-model"],
    );
    assert.equal(saved.models.getExact(providerId, "nex-2.5-pro"), undefined);
    assert.equal(
      saved.models.getExact(providerId, "remaining-model")?.properties.contextWindow,
      8192,
    );
    assert.deepEqual(saved.providers.get(providerId)?.modelOrder, [
      "remaining-model",
      "manual-model",
    ]);
    runtime.dispose();
    runtime = new NodeProviderConfigRuntime(options);
    await assertModelIds(["remaining-model", "manual-model"]);
    await refresh(catalog());
    await assertModelIds(["manual-model"]);
    assert.deepEqual(
      (await runtime.personalRepository.read()).modelCatalogs?.[providerId]?.models,
      [],
    );
  } finally {
    runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("catalog snapshot survives restart, preserves manual overrides and rejects stale writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-modellink-"));
  const file = join(dir, "provider_config.json");
  const options = {
    zcodeBuiltinFilePath: bundled,
    personalFilePath: file,
    personalPollingIntervalMs: false as const,
  };
  let runtime = new NodeProviderConfigRuntime(options);
  try {
    const created = await runtime.configService.createPersonalProvider({
      providerName: "ModelLink Chat",
      catalogSource: "modellink",
      initialConfig: parseProviderConfig({ api: { type: "openai-chat-completions" } }),
    });
    const id = created.providerId;
    let personal = await runtime.personalRepository.read();
    assert.equal(personal.providers.get(id)?.api?.baseUrl, undefined);
    assert.equal(personal.providers.get(id)?.access?.type, "api-key");
    await runtime.configService.savePersonalProviderOverlay(
      id,
      parseProviderConfig({
        group: "standard-personal",
        api: { type: "openai-chat-completions", baseUrl: "http://127.0.0.1:32123/v1" },
        access: { type: "api-key", apiKey: "test-only" },
      }),
    );
    personal = await runtime.personalRepository.read();
    const oldRevision = personal.revision;
    const models = normalizeModelLinkCatalog(
      { data: [model("chat-model", "chat_completions")] },
      "openai-chat-completions",
    );
    await runtime.configService.saveModelCatalog(id, models, oldRevision);
    await assert.rejects(runtime.configService.saveModelCatalog(id, [], oldRevision), /revision/);
    const snapshot = await runtime.configService.read();
    const resolution = new ProviderConfigResolver().resolve({
      ...snapshot,
      accountProviders: ProviderConfigMap.empty(),
    });
    const candidate = resolution.registryProviders.find((p) => p.providerId === id)?.models[0];
    assert.equal(candidate?.config.properties.contextWindow, 32000);
    const manual = extractManualModelConfig(candidate!.config.toJSON());
    manual.properties.contextWindow = 8192;
    await runtime.configService.savePersonalModelDraft(
      id,
      "chat-model",
      "chat-model",
      parseModelConfig(manual),
      (await runtime.personalRepository.read()).revision,
      false,
    );
    await runtime.configService.saveModelCatalog(
      id,
      normalizeModelLinkCatalog(
        { data: [model("chat-model", "chat_completions", 64000)] },
        "openai-chat-completions",
      ),
      (await runtime.personalRepository.read()).revision,
    );
    await runtime.configService.saveAuxiliaryModelSelection({
      providerId: id,
      modelId: "chat-model",
      options: { reasoningLevel: "high" },
    });
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.config.auxiliaryModelSelection.options.reasoningLevel, "high");
    assert.equal(saved.config.modelCatalogs[id].models[0].modelId, "chat-model");
    const provisioned = decodeProviderConfigFile({
      schemaVersion: 2,
      config: providerProvisioningPersonalConfigSchema.parse(saved.config),
    });
    assert.deepEqual(provisioned.modelCatalogs, saved.config.modelCatalogs);
    assert.equal(provisioned.auxiliaryModelSelection?.options?.reasoningLevel, "high");
    runtime.dispose();
    runtime = new NodeProviderConfigRuntime(options);
    const afterRestart = new ProviderConfigResolver().resolve({
      ...(await runtime.configService.read()),
      accountProviders: ProviderConfigMap.empty(),
    });
    assert.equal(
      afterRestart.registryProviders[0]!.models[0]!.config.properties.contextWindow,
      8192,
    );
    const beforeConnectionChange = await runtime.personalRepository.read();
    await runtime.configService.savePersonalProviderOverlay(
      id,
      beforeConnectionChange.providers
        .get(id)!
        .overlay(parseProviderConfig({ api: { baseUrl: "http://127.0.0.1:32124/another/v1" } })),
    );
    const changedConnection = await runtime.personalRepository.read();
    assert.equal(changedConnection.modelCatalogs?.[id]?.fetchedAt, null);
    assert.equal(
      new ProviderConfigResolver().resolve({
        ...(await runtime.configService.read()),
        accountProviders: ProviderConfigMap.empty(),
      }).registryProviders.length,
      0,
    );
    await assert.rejects(
      runtime.configService.saveModelCatalog(id, models, beforeConnectionChange.revision),
      /revision/,
    );
    await runtime.configService.saveModelCatalog(
      id,
      [],
      (await runtime.personalRepository.read()).revision,
    );
    assert.equal(
      new ProviderConfigResolver().resolve({
        ...(await runtime.configService.read()),
        accountProviders: ProviderConfigMap.empty(),
      }).registryProviders.length,
      0,
    );
    await runtime.configService.saveModelCatalog(
      id,
      models,
      (await runtime.personalRepository.read()).revision,
    );
    await runtime.configService.detachCatalogModel(id, "chat-model");
    await runtime.configService.saveModelCatalog(
      id,
      models,
      (await runtime.personalRepository.read()).revision,
    );
    assert.equal((await runtime.personalRepository.read()).modelCatalogs?.[id]?.models.length, 0);
    assert.equal(
      new ProviderConfigResolver().resolve({
        ...(await runtime.configService.read()),
        accountProviders: ProviderConfigMap.empty(),
      }).registryProviders[0]!.models[0]!.config.properties.contextWindow,
      32000,
    );
  } finally {
    runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("catalog fetch uses only user Base URL and API Key and rejects incomplete connections", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const transport: typeof fetch = async (url, init) => {
    requests.push({
      url: String(url),
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return Response.json({ data: [model("chat-model", "chat_completions")] });
  };
  await assert.rejects(
    loadModelLinkCatalog(
      parseProviderConfig({ api: { type: "openai-chat-completions" } }),
      transport,
    ),
    /Base URL/,
  );
  assert.equal(requests.length, 0);
  const config = parseProviderConfig({
    api: {
      type: "openai-chat-completions",
      baseUrl: "http://127.0.0.1:32123/custom/v1/?tenant=test",
    },
    access: { type: "api-key", apiKey: "custom-key" },
  });
  const models = await loadModelLinkCatalog(config, transport);
  assert.equal(models.length, 1);
  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:32123/custom/v1/models?tenant=test&include=modellink",
      authorization: "Bearer custom-key",
    },
  ]);
  await assert.rejects(
    loadModelLinkCatalog(config, async () => new Response("failed", { status: 503 })),
    /503/,
  );
});

test("personal config v1 migrates once without changing existing providers or default selection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-modellink-migration-"));
  const file = join(dir, "provider_config.json");
  const runtime = new NodeProviderConfigRuntime({
    zcodeBuiltinFilePath: bundled,
    personalFilePath: file,
    personalPollingIntervalMs: false,
  });
  try {
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        config: {
          providerConfigRules: { providerRules: [] },
          modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
          defaultModelSelection: {
            providerId: "existing",
            modelId: "existing-model",
            options: { reasoningLevel: "high" },
          },
        },
      }),
    );
    const current = await runtime.personalRepository.read();
    assert.equal(current.defaultModelSelection?.modelId, "existing-model");
    assert.deepEqual(current.modelCatalogs, {});
    assert.equal(JSON.parse(await readFile(file, "utf8")).schemaVersion, 2);
  } finally {
    runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
