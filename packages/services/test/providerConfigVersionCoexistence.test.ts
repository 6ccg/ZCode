import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { encodeProviderConfigFile } from "@zcode/provider-node";
import { importLegacyPersonalProviderConfig } from "../src/model-provider/legacyPersonalProviderConfigImporter.js";
import { createProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

test("modified provider config copies original v1 once and never rewrites it", async () => {
  const base = await mkdtemp(join(tmpdir(), "zcode-version-coexistence-"));
  setDataBaseDir(base);
  const root = getAppConfigDir();
  const originalPath = join(root, "provider_config.json");
  const modifiedPath = join(root, "provider_config.zcode-modified.json");
  const layer = importLegacyPersonalProviderConfig({
    legacyProviders: [
      {
        id: "custom-example",
        name: "Example",
        source: "custom",
        enabled: true,
        apiKey: "test-only-key",
        baseURL: "https://provider.example/v1",
        models: ["model-a"],
        endpoints: { baseURL: "https://provider.example/v1" },
      } as any,
    ],
  });
  const encoded = encodeProviderConfigFile(layer);
  const original = JSON.stringify(
    {
      schemaVersion: 1,
      config: {
        providerConfigRules: encoded.config.providerConfigRules,
        modelConfigRules: encoded.config.modelConfigRules,
      },
    },
    null,
    2,
  );
  await mkdir(root, { recursive: true });
  await writeFile(originalPath, original);
  const recoveries: unknown[] = [];
  const runtime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    personalPollingIntervalMs: false,
    watch: false,
    onPersonalConfigRecovery: (event) => recoveries.push(event.error),
  });
  try {
    const first = await runtime.personalRepository.read();
    assert.deepEqual(recoveries, []);
    assert.ok(first.providers.get("custom-example"));
    assert.equal(await readFile(originalPath, "utf8"), original);
    const sidecar = JSON.parse(await readFile(modifiedPath, "utf8"));
    assert.equal(sidecar.schemaVersion, 2);
    assert.equal(sidecar.config.providerConfigRules.providerRules[0].providerId, "custom-example");
    // 模拟原版之后改写其 v1 文件；修改版的 v2 快照不应被反向覆盖。
    await writeFile(originalPath, original.replace("custom-example", "custom-later"));
    const second = await runtime.personalRepository.read();
    assert.ok(second.providers.get("custom-example"));
    assert.equal(await readFile(modifiedPath, "utf8"), JSON.stringify(sidecar, null, 2));
  } finally {
    runtime.dispose();
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});
