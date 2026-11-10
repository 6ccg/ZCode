import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
assert.equal(process.platform, "darwin");
const bundle = resolve(process.argv[2]);
const server = await import(pathToFileURL(resolve(bundle, "runtime/broker-server.js")));
const { callBrokerMethod } = await import(pathToFileURL(resolve(bundle, "runtime/broker.js")));
const host = server.createProductCuaHelperHost({
  bundledHelperAppPath: resolve(bundle, "helper/ZCode Computer Use.app"),
  healthTimeoutMs: 30000,
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
  const { createPipSessionClient } = await import(
    pathToFileURL(resolve(bundle, "runtime/pip-session-node.js"))
  );
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
} finally {
  await host.stop();
}
