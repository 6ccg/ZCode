import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
assert.equal(process.platform, "darwin");
const bundle = resolve(process.argv[2]);
process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR = resolve(bundle, "runtime");
const scratch = await mkdtemp(resolve(tmpdir(), "zcode-cua-smoke-"));
console.log(
  execFileSync(
    resolve(bundle, "helper/ZCode Computer Use.app/Contents/MacOS/ZCode Computer Use"),
    ["--cua-helper-provenance-smoke"],
    { encoding: "utf8" },
  ),
);
const server = await import("../../packages/zcode-cua/broker-server.js");
const { callBrokerMethod } = await import("../../packages/zcode-cua/broker.js");
const host = server.createProductCuaHelperHost({
  bundledHelperAppPath: resolve(bundle, "helper/ZCode Computer Use.app"),
  healthTimeoutMs: 30000,
  exitLogPath: resolve(scratch, "helper.log"),
});
try {
  const first = await host.start();
  assert.ok(first.pid > 0);
  await assert.rejects(
    callBrokerMethod({ socketPath: first.socketPath, method: "broker_info", timeoutMs: 3000 }),
  );
  await assert.rejects(
    callBrokerMethod({
      socketPath: first.socketPath,
      pluginAuthority: "wrong-authority-0123456789",
      method: "broker_info",
      timeoutMs: 3000,
    }),
  );
  const permissions = await host.queryPermissionStatus();
  assert.equal(typeof permissions.accessibility, "string");
  process.env.ZCODE_CUA_PLUGIN_AUTHORITY = first.pluginAuthority;
  const { createComputerUseRuntime } = await import("../../packages/zcode-cua/index.js");
  const runtime = createComputerUseRuntime({ brokerSocketPath: first.socketPath });
  delete process.env.ZCODE_CUA_PLUGIN_AUTHORITY;
  try {
    const result = await runtime.execute({
      toolName: "request_access",
      arguments: {},
      context: {
        sessionId: "mac-ci",
        workspacePath: scratch,
        workspaceIdentity: scratch,
        runtimeScope: "main",
      },
    });
    assert.ok(!result.isError, JSON.stringify(result));
  } finally {
    await runtime.dispose();
  }
  const { createPipSessionClient } = await import("../../packages/zcode-cua/pip-session-node.js");
  const pip = createPipSessionClient({
    socketPath: first.socketPath,
    pluginAuthority: first.pluginAuthority,
    reconnectAttempts: 0,
  });
  await pip.connect();
  pip.close();
  console.log(JSON.stringify({ stage: "native", pid: first.pid, permissions }));
  await host.stop();
  assert.throws(() => process.kill(first.pid, 0));
  const second = await host.start();
  assert.notEqual(second.pid, first.pid);
  await host.checkHealth();
  console.log("Mac native helper authentication, PiP transport and stop/restart passed");
} catch (error) {
  console.error(
    await readFile(resolve(scratch, "helper.log"), "utf8").catch(
      () => "Helper did not create an exit log",
    ),
  );
  throw error;
} finally {
  await host.stop();
  await rm(scratch, { recursive: true, force: true });
}
