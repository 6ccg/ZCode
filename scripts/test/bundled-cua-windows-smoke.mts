// Native acceptance against a packaged application; only controls its own test form.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "win32");
const resources = resolve(process.argv[2]!);
const scratch = await mkdtemp(join(tmpdir(), "zcode-cua-native-"));
Object.defineProperty(process, "resourcesPath", { value: resources });
process.env.ZCODE_HOME = join(scratch, "home");
for (const key of [
  "ZCODE_CUA_RUNTIME_PACKAGE_DIR",
  "ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR",
  "ZCODE_CUA_DEV_ROOT",
])
  delete process.env[key];
const script = join(scratch, "fixture.ps1");
await writeFile(
  script,
  `param([string]$StateDir)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'ZCode CUA isolated acceptance'
$form.Width = 640; $form.Height = 400
$field = New-Object System.Windows.Forms.TextBox
$field.AccessibleName = 'CUA test input'; $field.Multiline = $true; $field.Dock = 'Fill'
$form.Controls.Add($field)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({[IO.File]::WriteAllText((Join-Path $StateDir 'value.txt'), $field.Text)})
$timer.Start()
$form.Add_Shown({$form.Hide(); $form.Show(); $form.Activate(); $field.Focus(); [IO.File]::WriteAllText((Join-Path $StateDir 'ready.json'), ('{"pid":' + $PID + '}'))})
$form.ShowDialog() | Out-Null
`,
);
const fixture = spawn(
  join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"),
  ["-NoProfile", "-STA", "-File", script, "-StateDir", scratch],
  { windowsHide: true, stdio: "ignore" },
);
let host: { stop(): Promise<void> } | undefined;
try {
  let pid: number | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      pid = JSON.parse(await readFile(join(scratch, "ready.json"), "utf8")).pid;
      break;
    } catch {
      await delay(100);
    }
  }
  assert.equal(pid, fixture.pid, "fixture must own its visible test form");
  const { createDefaultCuaProductHelper } = await import("../../packages/services/src/node.js");
  const { resolveWindowsCuaRuntime } =
    await import("../../packages/services/src/cua-permission-broker/windowsCuaDevRuntime.js");
  const executables = (await readdir(resolve(resources, ".."))).filter((name) =>
    /^ZCode.*\.exe$/i.test(name),
  );
  assert.equal(executables.length, 1);
  const helper = createDefaultCuaProductHelper({
    resolveWindowsRuntime: async () => ({
      ...(await resolveWindowsCuaRuntime({
        resourcesPath: resources,
        electronVersion: "44.7.0",
        arch: "x64",
      })),
      command: resolve(resources, "..", executables[0]!),
    }),
  });
  assert.ok(helper?.admissionTransport);
  host = helper.host;
  assert.equal(helper.host.running, false, "admission must not start a helper");
  const initial = helper.admissionTransport;
  const active = await helper.host.start();
  assert.equal(active.socketPath, initial.socketPath);
  assert.equal(active.pluginAuthority, initial.pluginAuthority);
  const { callBrokerMethod } = await import("../../packages/zcode-cua/broker.js");
  await assert.rejects(
    callBrokerMethod({
      socketPath: initial.socketPath,
      method: "controller_status",
      timeoutMs: 2000,
    }),
  );
  const require = createRequire(
    new URL("../../apps/zcode-cli/packages/node-repl-host/package.json", import.meta.url),
  );
  const { Client } = require("@modelcontextprotocol/client");
  const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");
  const mcp = new Client(
    { name: "packaged-cua-acceptance", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    ZCODE_CUA_PERMISSION_BROKER_SOCKET: initial.socketPath,
    ZCODE_CUA_PLUGIN_AUTHORITY: initial.pluginAuthority,
    ZCODE_CUA_RUNTIME_PACKAGE_DIR: join(resources, "tools/zcode-cua"),
    ZCODE_CUA_PLUGIN_ROOT: join(resources, "glm/packages/zcode-cua-plugin"),
  };
  const transport = new StdioClientTransport({
    command: resolve(resources, "..", executables[0]!),
    args: [join(resources, "glm/packages/node-repl-host/dist/mcp/server.js")],
    env: childEnv,
    stderr: "pipe",
  });
  try {
    await mcp.connect(transport);
    const clientUrl = pathToFileURL(
      join(resources, "glm/packages/zcode-cua-plugin/scripts/computer-use-client.mjs"),
    ).href;
    const code = [
      `const {setupComputerUseRuntime} = await import(${JSON.stringify(clientUrl)});`,
      "await setupComputerUseRuntime({globals:globalThis});",
      `const app = await agent.computerUse.getApp({pid:${pid}});`,
      "const shot = await app.getAXStateAndScreenshot();",
      'if (!shot.state.includes("CUA test input") || !shot.screenshot?.byteLength) throw new Error("Own fixture observation/screenshot missing");',
      'nodeRepl.write("OWN_CUA_SCREENSHOT_OK");',
    ].join("\n");
    const result = await mcp.callTool({
      name: "js",
      arguments: { code, title: "Verify bundled Computer Use" },
      _meta: {
        "com.zcode/request-context": {
          session_id: "packaged-cua-acceptance",
          runtime_scope: "main",
          workspace_path: scratch,
          workspace_identity: scratch,
          turn_id: "native-check",
        },
      },
    });
    const diagnostics = result.content
      .filter((item: { type: string }) => item.type === "text")
      .map((item: { text: string }) => item.text)
      .join("\n");
    assert.ok(!result.isError, diagnostics);
    assert.match(diagnostics, /OWN_CUA_SCREENSHOT_OK/);
    assert.ok(
      result.content.some((item: { type: string }) => item.type === "image"),
      "MCP must preserve the own-window screenshot",
    );
    console.log(
      "Packaged node_repl MCP and bundled Computer Use SDK observation/screenshot passed.",
    );
  } finally {
    await mcp.close();
  }
  const permissions = await callBrokerMethod<{ accessibility: string }>({
    socketPath: initial.socketPath,
    method: "permission_status",
    timeoutMs: 3000,
    pluginAuthority: initial.pluginAuthority,
  });
  assert.equal(typeof permissions.accessibility, "string");
  process.env.ZCODE_CUA_PLUGIN_AUTHORITY = initial.pluginAuthority;
  process.env.ZCODE_CUA_PLUGIN_ROOT = join(resources, "glm/packages/zcode-cua-plugin");
  const { createComputerUseRuntime } = await import("../../packages/zcode-cua/index.js");
  const runtime = createComputerUseRuntime({ brokerSocketPath: initial.socketPath });
  // 模拟 plugin host 恢复 env，验证 runtime 使用 admission 时捕获的凭据。
  delete process.env.ZCODE_CUA_PLUGIN_AUTHORITY;
  const context = {
    sessionId: "native-acceptance",
    workspaceKey: scratch,
    workspacePath: scratch,
    runtimeScope: "main" as const,
  };
  try {
    const state = await runtime.execute({
      toolName: "get_app_state",
      arguments: { app_ref: { pid }, include_screenshot: true },
      context,
    });
    assert.ok(!state.isError);
    assert.ok(
      state.content.some((item) => item.type === "image"),
      "own form screenshot must be captured",
    );
    const fresh = await runtime.execute({
      toolName: "get_app_state",
      arguments: { app_ref: { pid }, disable_diffing: true },
      context,
    });
    const text = fresh.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const index = Number(text.match(/\[(\d+)\] textfield CUA test input/)?.[1]);
    assert.ok(Number.isInteger(index));
    const expected = `CUA_OK_${Date.now()}`;
    const input = await runtime.execute({
      toolName: "type",
      arguments: { app_ref: { pid }, target: { type: "element", index }, text: expected },
      context,
    });
    assert.ok(!input.isError);
    let matched = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await readFile(join(scratch, "value.txt"), "utf8")) === expected) {
        matched = true;
        break;
      }
      await delay(100);
    }
    assert.equal(matched, true, "independent UI readback must match the dispatched input");
  } finally {
    await runtime.dispose();
  }
  const restarted = await helper.host.restart();
  assert.notEqual(restarted.pid, active.pid);
  await helper.host.checkHealth();
  console.log(
    "Packaged CUA native acceptance passed: admission, authentication, observation, screenshot, input/readback and stop/restart.",
  );
} finally {
  await host?.stop();
  if (fixture.exitCode === null && fixture.signalCode === null) {
    const exited = new Promise<void>((done) => fixture.once("exit", () => done()));
    fixture.kill();
    await exited;
  }
  await rm(scratch, { recursive: true, force: true });
}
