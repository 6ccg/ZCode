import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseModelConfig, parseProviderConfig } from "@zcode/provider";
import { NodeProviderRegistryRuntime } from "../src/provider-registry-runtime.js";
import { decodeZCodeBuiltinRelease } from "../src/zcode-builtin-release.js";

const bundledFile = fileURLToPath(
  new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
);
const readBundled = async () => JSON.parse(await readFile(bundledFile, "utf8"));

test("bundled configuration retains upstream vendor templates and account channels", async () => {
  const release = decodeZCodeBuiltinRelease(await readBundled());
  assert.ok(release.config.providers.has("account:zai-individual-coding-plan"));
  assert.ok(release.config.providerTemplates.get("zai-api"));
  assert.ok(release.config.providerTemplates.get("zai-standard-api"));
  assert.ok(release.config.providerTemplates.get("openai"));
});

test("generic channels coexist with upstream templates and survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-generic-channels-"));
  const personalFilePath = join(directory, "personal.json");
  const cachePath = join(directory, "old-builtin.json");
  const oldRelease = await readBundled();
  oldRelease.revision += 1000;
  oldRelease.config.providerConfigRules.templateRules.push({
    templateId: "cached-template",
    templateNameMap: { "en-US": "Cached vendor" },
    config: { api: { type: "openai-chat-completions", baseUrl: "https://provider.example/v1" } },
  });
  await writeFile(cachePath, JSON.stringify(oldRelease));
  const options = {
    zcodeBuiltinFilePath: bundledFile,
    zcodeBuiltinActiveFilePath: cachePath,
    personalFilePath,
    personalPollingIntervalMs: false as const,
    watch: false,
  };
  let runtime = new NodeProviderRegistryRuntime(options);
  try {
    await runtime.start();
    const baselineCount = runtime.registryService.listProviders().length;
    assert.ok(
      (await runtime.configService.read()).zcodeBuiltinProviderTemplates.get("cached-template"),
    );
    const protocols = [
      "openai-chat-completions",
      "openai-responses",
      "anthropic-messages",
    ] as const;
    const ids: string[] = [];
    for (const protocol of protocols) {
      const created = await runtime.configService.createPersonalProvider({
        providerName: protocol,
        initialConfig: parseProviderConfig({
          access: { type: "api-key", apiKey: "test-only-key" },
          api: { type: protocol, baseUrl: "https://provider.example/v1" },
        }),
      });
      ids.push(created.providerId);
      await runtime.configService.addPersonalModel(
        created.providerId,
        "example-model",
        parseModelConfig({}),
      );
    }
    await runtime.registryService.refresh("test");
    for (const id of ids) assert.ok(runtime.registryService.getModel(id, "example-model"));
    await assert.rejects(
      runtime.configService.createPersonalProvider({ templateId: "missing-template" }),
    );
    runtime.dispose();
    runtime = new NodeProviderRegistryRuntime(options);
    await runtime.start();
    assert.equal(runtime.registryService.listProviders().length, baselineCount + 3);
    for (let index = 0; index < ids.length; index++) {
      assert.equal(
        runtime.registryService.getProvider(ids[index]!)?.config.api.type,
        protocols[index],
      );
    }
    await runtime.configService.deletePersonalProvider(ids[0]!);
    await runtime.registryService.refresh("delete");
    assert.equal(runtime.registryService.getProvider(ids[0]!), undefined);
    assert.equal(runtime.registryService.listProviders().length, baselineCount + 2);
  } finally {
    runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
