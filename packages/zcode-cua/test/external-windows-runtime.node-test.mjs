import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createComputerUseRuntime } from "../index.js";
import * as broker from "../broker.js";
import * as server from "../broker-server.js";
import * as frames from "../frame-contract.js";
import { createPipSessionClient } from "../pip-session-node.js";
import {
  externalWindowsCuaFunction,
  loadExternalWindowsCuaModule,
  resolveExternalWindowsCuaRuntime,
} from "../src/external-windows-runtime.js";

const roots = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "zcode-external-runtime-"));
  roots.push(root);
  const exports = {
    ".": { import: "./index.js" },
    "./broker": { import: "./broker.js" },
    "./broker/server": { import: "./server.js" },
    "./frame-contract": { import: "./frames.js" },
    "./pip-session/node": { import: "./pip.js" },
  };
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@zcode/zcode-cua",
      version: "0.6.3",
      type: "module",
      exports,
      ...overrides,
    }),
  );
  await writeFile(join(root, "state.js"), "export const calls = [];\n");
  await writeFile(
    join(root, "index.js"),
    `
    import { calls } from './state.js';
    export function createComputerUseRuntime(options) {
      calls.push(['create', options]);
      return {
        async execute(input) { calls.push(['execute', input]); return {content:[{type:'text',text:'external'}],structuredContent:input.arguments,_meta:{frame:'unchanged'}}; },
        async closeSession(context) { calls.push(['close', context]); },
        async dispose() { calls.push(['dispose']); }
      };
    }
  `,
  );
  await writeFile(
    join(root, "broker.js"),
    `
    import { calls } from './state.js';
    export async function callBrokerMethod(args) { calls.push(['rpc',args]); if(args.method==='fail') throw Object.assign(new Error('external failure'),{code:'not_authorized',details:{request_delivery_state:'not_sent'}}); return args; }
    export async function probeHelperHealth(socket, options) { calls.push(['health', socket, options]); return {pid:731,bundleId:null}; }
    export function mintBrokerSocketPath() { return '\\\\\\.\\\\pipe\\\\fixture'; }
    export function resolveBrokerSocketPath(options) { return options.env.ZCODE_CUA_PERMISSION_BROKER_SOCKET; }
    export function isCuaHelperError(value) { return value?.name === 'ExternalHelperError'; }
    export function parseRequestLine(line) { return {ok:true,request:JSON.parse(line)}; }
    export function okResponse(id,result,presentation) { return {id,ok:true,result,presentation}; }
  `,
  );
  await writeFile(
    join(root, "server.js"),
    `
    import { calls } from './state.js';
    export class CuaHelperLifecycleManager {
      constructor(dispose) { this.release=dispose; this.current=undefined; this.disposed=false; }
      async acquire(options) { if(this.disposed || options.isAdmitted?.()===false) return; return this.current ??= options.create(); }
      peek() { return this.current; }
      async dispose() { this.disposed=true; await this.release?.(this.current); }
    }
    export class CuaProductHelperWorkspaceRegistry { setEnabled(context,enabled) { calls.push(['enabled',context,enabled]); } }
    export function createCuaProductMcpServerResolver(host) { return {
      async resolveMcpServers(servers) { await host.start(); calls.push(['resolve',servers]); return servers; },
      async restart() { await host.restart(); }, async restartAfterPermissionGrant(id) { calls.push(['restart-grant',id]); await host.restartAfterCurrentStart(); }
    }; }
    export function isOfficialCuaPluginEnabledForWorkspace(options) { calls.push(['plugin', options]); return true; }
    export function cuaBrokerRefreshMarkerPath(socket) { return socket+'.refresh'; }
    export async function publishCuaBrokerRefreshMarker(socket) { return {path:socket+'.refresh'}; }
    export function isScreenCaptureProbeSuccess(result) { return result?.ok===true; }
  `,
  );
  await writeFile(
    join(root, "frames.js"),
    `
    export function isOfficialCuaImageRefText(text) { return text==='fixture-image-ref'; }
    export async function preserveOfficialCuaFrameResult(result) { return result; }
    export function attestOfficialCuaFrameContent(content,kind) { return {content,kind}; }
  `,
  );
  await writeFile(
    join(root, "pip.js"),
    "export function createPipSessionClient(options) { return { enabled:true, options }; }\n",
  );
  const options = { platform: "win32", env: { ZCODE_CUA_RUNTIME_PACKAGE_DIR: root } };
  const calls =
    overrides.type === "commonjs"
      ? []
      : createRequire(join(root, "package.json"))(join(root, "state.js")).calls;
  return { root, options, calls };
}

async function asWindows(root, run) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalRoot = process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR;
  Object.defineProperty(process, "platform", { value: "win32" });
  process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR = root;
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", platform);
    if (originalRoot === undefined) delete process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR;
    else process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR = originalRoot;
  }
}

test("non-Windows does not inspect or execute an external runtime", () => {
  assert.equal(
    loadExternalWindowsCuaModule(".", {
      platform: "linux",
      env: { ZCODE_CUA_RUNTIME_PACKAGE_DIR: "/missing" },
    }),
    undefined,
  );
});

test("packaged runtime root resolves without inherited development configuration", async () => {
  const { root } = await fixture();
  const resourcesPath = await mkdtemp(join(tmpdir(), "zcode-external-packaged-"));
  roots.push(resourcesPath);
  const packagedRoot = join(resourcesPath, "tools", "zcode-cua");
  await cp(root, packagedRoot, { recursive: true });
  const options = { platform: "win32", env: {}, resourcesPath };
  assert.equal(resolveExternalWindowsCuaRuntime(options).root, packagedRoot);
  assert.equal(
    typeof loadExternalWindowsCuaModule(".", options).createComputerUseRuntime,
    "function",
  );
  assert.deepEqual(server.resolveWindowsCuaRuntimeEnvironment(options), {
    ZCODE_CUA_RUNTIME_PACKAGE_DIR: packagedRoot,
  });
});

test("CUA candidate filtering is pure and works even when runtime configuration is broken", async () => {
  await asWindows("/does-not-exist", () => {
    const candidate = (value) => server.isPotentialZCodeCuaAgentMcpServer(value);
    assert.equal(candidate({ name: "computer-use", command: "node" }), true);
    assert.equal(candidate({ command: "C:\\runtime\\zcode_cua.exe" }), true);
    assert.equal(candidate({ command: "uvx", args: ["zcode-cua==1.0"] }), true);
    assert.equal(
      candidate({
        name: "plugin:computer-use:computer-use",
        command: "node",
        env: [{ name: "ZCODE_PLUGIN_ID", value: "computer-use@zcode-plugins-official" }],
      }),
      true,
    );
    assert.equal(
      candidate({ name: "files", command: "files-mcp", args: ["zcode-cuantity"] }),
      false,
    );
    assert.equal(candidate({ name: "computer-use", url: "https://example.invalid" }), false);
    assert.equal(candidate(null), false);
  });
});

test("external module loads through the declared public export", async () => {
  const f = await fixture();
  assert.equal(
    typeof externalWindowsCuaFunction(".", "createComputerUseRuntime", f.options),
    "function",
  );
  assert.equal(resolveExternalWindowsCuaRuntime(f.options).root, f.root);
});

test("public Windows runtime preserves execute context, signal, results and cleanup", async () => {
  const f = await fixture();
  await asWindows(f.root, async () => {
    const prepare = async () => {};
    const runtime = createComputerUseRuntime({
      brokerSocketPath: "fixture",
      ensureBrokerAvailable: prepare,
    });
    const input = {
      toolName: "get_app_state",
      arguments: { app_ref: { pid: 123 } },
      context: { sessionId: "s", workspaceKey: "w", runtimeScope: "main" },
      signal: new AbortController().signal,
    };
    const result = await runtime.execute(input);
    assert.equal(result.structuredContent, input.arguments);
    assert.deepEqual(result._meta, { frame: "unchanged" });
    assert.equal(f.calls[0][1].ensureBrokerAvailable, prepare);
    assert.equal(f.calls[1][1], input);
    await runtime.closeSession(input.context);
    await runtime.dispose();
    assert.deepEqual(f.calls.slice(2), [["close", input.context], ["dispose"]]);
  });
});

test("public broker sends original arguments and keeps real health/error details", async () => {
  const f = await fixture();
  await asWindows(f.root, async () => {
    const args = { socketPath: "fixture", method: "list_applications", params: {}, timeoutMs: 15 };
    assert.equal(await broker.callBrokerMethod(args), args);
    assert.deepEqual(await broker.probeHelperHealth("fixture", { timeoutMs: 20 }), {
      pid: 731,
      bundleId: null,
    });
    await assert.rejects(broker.callBrokerMethod({ method: "fail", socketPath: "fixture" }), {
      code: "not_authorized",
      details: { request_delivery_state: "not_sent" },
    });
    assert.equal(broker.isCuaHelperError(new broker.CuaHelperError("local")), true);
    assert.equal(broker.isCuaHelperError({ name: "ExternalHelperError" }), true);
    assert.deepEqual(broker.okResponse(7, { ok: 1 }, { frame: 2 }), {
      id: 7,
      ok: true,
      result: { ok: 1 },
      presentation: { frame: 2 },
    });
  });
});

test("public lifecycle, registry and MCP resolver reach the external implementation", async () => {
  const f = await fixture();
  await asWindows(f.root, async () => {
    let stopped = 0;
    const managed = { value: 1 };
    const lifecycle = new server.CuaHelperLifecycleManager(async (value) => {
      assert.equal(value, managed);
      stopped++;
    });
    assert.equal(await lifecycle.acquire({ create: () => managed }), managed);
    assert.equal(lifecycle.peek(), managed);
    await lifecycle.dispose();
    assert.equal(stopped, 1);
    assert.equal(lifecycle.disposed, true);
    new server.CuaProductHelperWorkspaceRegistry().setEnabled({ workspacePath: "w" }, true);
    let starts = 0;
    const resolver = server.createCuaProductMcpServerResolver({
      start: async () => {
        starts++;
      },
    });
    const servers = [{ name: "node_repl" }];
    assert.equal(await resolver.resolveMcpServers(servers), servers);
    assert.equal(starts, 1);
    assert.equal(server.isOfficialCuaPluginEnabledForWorkspace({ workingDirectory: "w" }), true);
    assert.equal(server.cuaBrokerRefreshMarkerPath("fixture"), "fixture.refresh");
  });
});

test("frame and PiP public contracts preserve the external session identity", async () => {
  const f = await fixture();
  await asWindows(f.root, async () => {
    const value = { content: [{ type: "image", data: "fixture" }], _meta: { frame: "opaque" } };
    assert.equal(await frames.preserveOfficialCuaFrameResult(value), value);
    assert.equal(frames.isOfficialCuaImageRefText("fixture-image-ref"), true);
    assert.equal(createPipSessionClient({ fixture: true }).enabled, true);
  });
});

test("missing module function reports contract mismatch instead of no-op success", async () => {
  const f = await fixture();
  assert.throws(
    () => externalWindowsCuaFunction("./broker", "missing", f.options),
    /does not implement missing/,
  );
});

test("invalid explicit root does not fall back to packaged runtime", async () => {
  const f = await fixture();
  const resourcesPath = await mkdtemp(join(tmpdir(), "zcode-resources-"));
  roots.push(resourcesPath);
  await mkdir(join(resourcesPath, "tools"));
  await symlink(f.root, join(resourcesPath, "tools/zcode-cua"), "junction");
  assert.throws(
    () =>
      resolveExternalWindowsCuaRuntime({
        platform: "win32",
        resourcesPath,
        env: { ZCODE_CUA_RUNTIME_PACKAGE_DIR: join(f.root, "missing") },
      }),
    /configured bundle cannot be loaded/,
  );
});

for (const [label, overrides] of [
  ["wrong identity", { name: "other" }],
  ["recursive placeholder", { zcodeCuaPlaceholder: true }],
  ["unbundled dependencies", { dependencies: { missing: "1" } }],
  ["wrong module type", { type: "commonjs" }],
])
  test(`rejects ${label}`, async () => {
    const f = await fixture(overrides);
    assert.throws(() => resolveExternalWindowsCuaRuntime(f.options), /expected a dependency-free/);
  });

test("rejects escaping and non-JavaScript public exports", async () => {
  for (const target of [
    "../escape.js",
    "./part/../../escape.js",
    "./native.node",
    "./part\\entry.js",
  ]) {
    const f = await fixture({ exports: { ".": { import: target } } });
    assert.throws(() => loadExternalWindowsCuaModule(".", f.options), /invalid public export/);
  }
});
