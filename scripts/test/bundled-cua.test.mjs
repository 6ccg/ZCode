import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  assertPrivateOutput,
  extractRuntime,
  patchWindowsHelper,
  replaceFunctionBody,
  requireHash,
  sha256,
} from "../bundled-cua.mjs";

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
  const source = `// ../../../../packages/zcode-cua/dist/index.js
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
  const reference =
    'const prelude = true;\nimport { homedir as homedir2 } from "node:os";\nexport { plan };';
  const result = extractRuntime(source, reference);
  assert.doesNotMatch(result, /fetch\(|kind: "download"|unrelated application code/);
  assert.match(result, /if \(!bundledAppPath\) throw/);
  assert.match(result, /export \{ plan \}/);
  assert.throws(
    () => extractRuntime(source.replace("dist/index.js", "dist/renamed.js"), reference),
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
