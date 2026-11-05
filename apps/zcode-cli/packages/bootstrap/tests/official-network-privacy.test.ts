import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS } from "@zcode/shared";
import { createMcpAdapter } from "@zcode/adapters/mcp";
import { createServer } from "node:http";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "../src/app/official-plugin-definitions.js";
import {
  guardOfficialPluginNetworkOrigins,
  isOfficialNetworkPluginEnabled,
} from "../src/plugins.js";

it("官方联网插件默认关闭，Settings 与 CLI 保持一致", () => {
  for (const name of ["zcode-site", "image-search"]) {
    expect(OFFICIAL_PLUGIN_DEFINITIONS.find((plugin) => plugin.name === name)?.defaultEnabled).toBe(
      false,
    );
    expect(DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS.has(`${name}@zcode-plugins-official`)).toBe(false);
  }
  expect(DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS.has("documents@zcode-plugins-official")).toBe(true);
});

it("旧调用逐次读取开启、关闭及卸载状态；配置失效不得恢复联网", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-network-privacy-"));
  const userConfigPath = join(root, "config.json");
  const options = { userConfigPath, workingDirectory: root, env: {} };
  const pluginId = "zcode-site@zcode-plugins-official";
  try {
    expect(await isOfficialNetworkPluginEnabled(pluginId, options)).toBe(false);
    await writeFile(
      userConfigPath,
      JSON.stringify({ plugins: { enabledPlugins: { [pluginId]: true } } }),
    );
    expect(await isOfficialNetworkPluginEnabled(pluginId, options)).toBe(true);
    expect(await isOfficialNetworkPluginEnabled("zcode-site", options)).toBe(true);
    await writeFile(
      userConfigPath,
      JSON.stringify({ plugins: { enabledPlugins: { [pluginId]: false } } }),
    );
    expect(await isOfficialNetworkPluginEnabled(pluginId, options)).toBe(false);
    await writeFile(
      userConfigPath,
      JSON.stringify({
        plugins: {
          enabledPlugins: { [pluginId]: true },
          suppressedBuiltins: [pluginId],
        },
      }),
    );
    expect(await isOfficialNetworkPluginEnabled(pluginId, options)).toBe(false);
    await writeFile(userConfigPath, "{invalid");
    expect(await isOfficialNetworkPluginEnabled(pluginId, options)).toBe(false);
    expect(await isOfficialNetworkPluginEnabled("my-mcp@user-market", options)).toBe(true);
    expect(await isOfficialNetworkPluginEnabled("image-search@user-market", options)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("官方 MCP 已关闭时连匿名发现请求也不得外发", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-network-zero-"));
  let received = 0;
  let credentials = 0;
  const server = createServer((_req, res) => {
    received++;
    res.writeHead(401).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  const adapter = createMcpAdapter({
    officialMcpAuth: {
      trustedOrigins: guardOfficialPluginNetworkOrigins(
        { isTrusted: async () => ({ trusted: true }) },
        {
          userConfigPath: join(root, "config.json"),
          workingDirectory: root,
          env: {},
        },
      ),
      authHeadersPort: {
        resolveHeaders: async () => {
          credentials++;
          return { ok: false, reason: "official_auth_unavailable" };
        },
      },
    },
    workingDirectory: root,
  });
  try {
    const status = await adapter.connectServer("plugin:image-search:image_search", {
      type: "http",
      url: `http://127.0.0.1:${port}/mcp`,
      auth: { type: "zcode_official", provider: "jwt_token" },
      official: {
        mcpKey: "image_search",
        pluginId: "image-search@zcode-plugins-official",
        source: "plugin",
      },
    });
    expect(status.status).toBe("failed");
    expect(received).toBe(0);
    expect(credentials).toBe(0);
  } finally {
    await adapter.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
