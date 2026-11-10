import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  assertPrivateOutput,
  collectRuntimeExports,
  collectRuntimeCalls,
  extractRuntime,
  patchWindowsHelper,
  replaceFunctionBody,
  requireHash,
  sha256,
} from "../bundled-cua.mjs";
import { CuaHelperLifecycleManager } from "../cua-runtime-adapter/host-lifecycle.js";
import { CuaProductHelperWorkspaceRegistry } from "../cua-runtime-adapter/host-workspaces.js";

test("derive the current runtime surface from maintained named imports and exports", () => {
  const factory = 'export { createComputerUseRuntime } from "./vendor/dist-index.js";';
  assert.deepEqual(
    collectRuntimeExports([
      factory,
      'import { BrokerClient as Client } from "./vendor/dist-index.js";',
    ]),
    ["BrokerClient", "createComputerUseRuntime"],
  );
  assert.throws(
    () => collectRuntimeExports([factory, 'export * from "./vendor/dist-index.js";']),
    /explicitly/,
  );
  assert.throws(() => collectRuntimeExports([]), /factory/);
});

test("current public call contracts are explicit and checked independently of the old bridge", () => {
  assert.deepEqual(
    collectRuntimeCalls(['externalWindowsCuaFunction("./broker", "probeHelperHealth");']),
    [{ entry: "./broker", name: "probeHelperHealth" }],
  );
  assert.throws(
    () => collectRuntimeCalls(['externalWindowsCuaFunction(entry, "probeHelperHealth");']),
    /explicitly/,
  );
});

test("one admitted lifecycle instance survives concurrent acquire and terminal disposal", async () => {
  let created = 0,
    stopped = 0;
  const stopping = Promise.withResolvers(),
    finishStop = Promise.withResolvers();
  const manager = new CuaHelperLifecycleManager(async () => {
    stopped++;
    stopping.resolve();
    await finishStop.promise;
  });
  const options = { isAdmitted: () => true, create: () => ({ generation: ++created }) };
  const [first, second] = await Promise.all([manager.acquire(options), manager.acquire(options)]);
  assert.equal(first, second);
  assert.equal(created, 1);
  const disposal = manager.dispose();
  assert.equal(manager.disposed, true);
  await stopping.promise;
  finishStop.resolve();
  await disposal;
  assert.equal(stopped, 1);
  assert.equal(await manager.acquire(options), undefined);
});

test("workspace admission keeps identities distinct even when filesystem paths match", () => {
  const registry = new CuaProductHelperWorkspaceRegistry();
  registry.setEnabled(
    { workspaceKey: "first", workspaceIdentity: "first", workspacePath: "same" },
    true,
  );
  registry.setEnabled(
    { workspaceKey: "second", workspaceIdentity: "second", workspacePath: "same" },
    true,
  );
  assert.equal(registry.snapshot().length, 2);
  registry.setEnabled({ workspaceKey: "first" }, false);
  assert.deepEqual(registry.snapshot(), [{ workspacePath: "same", workspaceIdentity: "second" }]);
});

test("private vendor output cannot enter the public checkout", () => {
  assert.throws(
    () => assertPrivateOutput(resolve(import.meta.dirname, "../..", "vendor")),
    /outside/,
  );
  assert.throws(() => assertPrivateOutput("relative"), /absolute/);
  assertPrivateOutput(resolve(import.meta.dirname, "../../..", "ZCode-private"));
});

test("reject damaged pinned inputs", () => {
  const bytes = Buffer.from("official bytes");
  requireHash(bytes, sha256(bytes), "test");
  assert.throws(() => requireHash(Buffer.from("changed"), sha256(bytes), "test"), /mismatch/);
});

test("function patch is bounded even with nested braces and stops on version drift", () => {
  const result = replaceFunctionBody(
    'async function download() { if (true) { return "}"; } }\nfunction keep() { return 2; }',
    "download",
    'throw new Error("disabled");',
  );
  assert.match(result, /function keep\(\) \{ return 2;/);
  assert.doesNotMatch(result, /if \(true\)/);
  assert.throws(() => replaceFunctionBody(result, "missing", ""), /exactly one/);
});

test("extraction removes executable helper download paths", () => {
  const source = `const currentBundlerPrelude = true;
// ../../../../node_modules/unrelated/index.js
throw new Error("unrelated preceding application code");
// ../../../../packages/zcode-cua/dist/index.js
class Broker { constructor(options) {
    this.operationHooks = options.operationHooks;
} }
const runtimeOptions = {
    operationHooks: sessionOperationHooks(),
};
const requestOptions = {
      onPresentation: recordBrokerPresentation
};
const auth = {
      clientApiVersion: CUA_BROKER_IPC_VERSION,
};
async function stageDownloadedHelperApp() { return fetch("https://example.invalid"); }
async function defaultDownloadFile() { return fetch("https://example.invalid"); }
function plan() {
  const source = bundledAppPath ? { kind: "bundled", appPath: bundledAppPath } : (() => {
    return { kind: "download" };
  })();
  const installRoot = "root";
}
// ../../../../packages/shared/src/browser-use/command-metadata.ts
throw new Error("unrelated application code");`;
  const result = extractRuntime(source, ["plan"]);
  assert.doesNotMatch(result, /fetch\(|kind: "download"|unrelated application code/);
  assert.match(result, /if \(!bundledAppPath\) throw/);
  assert.match(result, /export \{ plan \}/);
  assert.match(result, /currentBundlerPrelude/);
  assert.doesNotMatch(result, /unrelated preceding application code/);
  assert.throws(
    () => extractRuntime(source.replace("dist/index.js", "dist/renamed.js"), ["plan"]),
    /boundaries/,
  );
});

test("Windows authenticate rejects missing/wrong Host authority before admitting tools", () => {
  const source = `class Broker {
  handleAuthenticate(conn, request) {
    return "admitted";
  }
}
// any local process can drive Computer Use`;
  const patched = patchWindowsHelper(source);
  const expected = "test-authority-0123456789";
  const Broker = new Function("process", "errorResponse", `${patched}\nreturn Broker;`)(
    { env: { ZCODE_CUA_PLUGIN_AUTHORITY: expected } },
    (_id, code) => code,
  );
  const conn = {};
  assert.equal(new Broker().handleAuthenticate(conn, { id: 0, params: {} }), "not_authorized");
  assert.equal(conn.closeAfterWrite, true);
  assert.equal(
    new Broker().handleAuthenticate({}, { id: 0, params: { pluginAuthority: "wrong" } }),
    "not_authorized",
  );
  assert.equal(
    new Broker().handleAuthenticate({}, { id: 0, params: { pluginAuthority: expected } }),
    "admitted",
  );
});
