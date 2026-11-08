import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceComputerUseRuntime } from "../src/source-runtime.js";
import { createComputerUseRuntime } from "../index.js";
const context = { sessionId: "a", runtimeScope: "main", workspaceKey: "local" };
const app_ref = { name: "TextEdit" };
const observation = {
  app: app_ref,
  window: {},
  elements: [],
  text: "tree",
  backendState: { private: true },
};
function fixture(overrides = {}) {
  const calls = [];
  const backend = {
    requestAccess: async () => ({ permissionsGranted: false }),
    listApps: async () => [],
    getAppState: async () => observation,
    act: async (...args) => {
      calls.push(args);
      return { action_sent: true };
    },
    ...overrides,
  };
  const runtime = createSourceComputerUseRuntime({ backend });
  return {
    runtime,
    calls,
    invoke: (toolName, args = {}, ctx = context) =>
      runtime.execute({ toolName, arguments: args, context: ctx }),
  };
}
test("default entry remains unavailable and does not prepare legacy broker", async () => {
  const runtime = createComputerUseRuntime({
    ensureBrokerAvailable: () => assert.fail("unexpected broker"),
  });
  assert.equal((await runtime.execute({ toolName: "list_apps", context })).isError, true);
});
test("source entry fails closed on Linux", async () => {
  if (process.platform === "darwin") return;
  const runtime = createComputerUseRuntime({ sourceBackend: "macos-ax" });
  try {
    assert.equal((await runtime.execute({ toolName: "list_apps", context })).isError, true);
  } finally {
    await runtime.dispose();
  }
});
test("reject remote, subagent, screenshot and unsupported tools without backend calls", async () => {
  const f = fixture({ getAppState: () => assert.fail("backend called") });
  try {
    for (const ctx of [
      { ...context, remoteSessionId: "remote" },
      { ...context, runtimeScope: "subagent" },
      { ...context, deliveryKind: "web-remote-replayable" },
    ])
      assert.equal((await f.invoke("list_apps", {}, ctx)).structuredContent.code, "not_authorized");
    assert.equal((await f.invoke("key")).structuredContent.code, "action_unavailable");
    assert.equal(
      (await f.invoke("get_app_state", { app_ref, include_screenshot: true })).structuredContent
        .code,
      "action_unavailable",
    );
  } finally {
    await f.runtime.dispose();
  }
});
test("observation private state never leaves runtime; action consumes it", async () => {
  const f = fixture();
  try {
    assert.equal(
      (await f.invoke("set_value", { app_ref })).structuredContent.code,
      "element_unavailable",
    );
    const state = await f.invoke("get_app_state", { app_ref });
    assert.equal(state.structuredContent.backendState, undefined);
    assert.ok(state.structuredContent.state_id);
    await f.invoke("set_value", { app_ref, target: { type: "element", index: 1 }, value: "test" });
    assert.deepEqual(f.calls[0][3], { private: true });
    assert.equal(
      (await f.invoke("set_value", { app_ref })).structuredContent.code,
      "element_unavailable",
    );
  } finally {
    await f.runtime.dispose();
  }
});
test("global lease isolates sessions and runtime instances; stop releases it", async () => {
  const a = fixture(),
    b = fixture();
  try {
    await a.invoke("list_apps");
    assert.equal(
      (await a.invoke("list_apps", {}, { ...context, sessionId: "b" })).structuredContent.code,
      "controller_busy",
    );
    assert.equal((await b.invoke("list_apps")).structuredContent.code, "controller_busy");
    await a.invoke("stop_computer_control");
    assert.equal((await b.invoke("list_apps")).isError, undefined);
  } finally {
    await a.runtime.dispose();
    await b.runtime.dispose();
  }
});
test("unknown dispatch failure is possibly_sent, explicit denial is not_sent", async () => {
  for (const error of [
    new Error("lost receipt"),
    Object.assign(new Error("cancelled"), { actionSent: false, code: "permission_denied" }),
  ]) {
    const f = fixture({
      act: async () => {
        throw error;
      },
    });
    try {
      await f.invoke("get_app_state", { app_ref });
      const outcome = await f.invoke("set_value", { app_ref });
      assert.equal(outcome.structuredContent.action_sent, error.actionSent !== false);
      assert.equal(
        (await f.invoke("set_value", { app_ref })).structuredContent.code,
        "element_unavailable",
      );
    } finally {
      await f.runtime.dispose();
    }
  }
});
test("stop cancels active observation and queued calls; late result cannot restore state", async () => {
  let release, started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({
    getAppState: async () => {
      started();
      return pending;
    },
  });
  try {
    const observationCall = f.invoke("get_app_state", { app_ref });
    await began;
    const queued = f.invoke("list_apps");
    await f.invoke("stop_computer_control");
    release(observation);
    assert.equal((await observationCall).structuredContent.code, "CONTROL_STOPPED");
    assert.equal((await queued).structuredContent.code, "CONTROL_STOPPED");
    assert.equal(
      (await f.invoke("set_value", { app_ref })).structuredContent.code,
      "element_unavailable",
    );
  } finally {
    await f.runtime.dispose();
  }
});
test("close and dispose invalidate observation and all later calls", async () => {
  const f = fixture();
  await f.invoke("get_app_state", { app_ref });
  await f.runtime.closeSession(context);
  assert.equal(
    (await f.invoke("set_value", { app_ref })).structuredContent.code,
    "element_unavailable",
  );
  await f.runtime.dispose();
  assert.equal((await f.invoke("list_apps")).structuredContent.code, "CONTROL_STOPPED");
});
test("existing SDK observes normalized app identity then sets value through source runtime", async () => {
  const { setupComputerUseRuntime } =
    await import("../../../apps/zcode-cli/packages/zcode-cua-plugin/scripts/computer-use-client.mjs");
  const f = fixture({
    getAppState: async () => ({
      ...observation,
      app: { pid: 42, bundle_id: "test.editor", name: "TextEdit" },
      elements: [{ index: 0, kind: "AXTextField", title: "Text", value: "", actions: [] }],
      text: "[0] AXTextField Text",
    }),
  });
  try {
    const globals = {
      process: { platform: "darwin" },
      nodeRepl: { write() {}, emitStructuredResult() {} },
    };
    globals[Symbol.for("zcode.node-repl.computer-use-bridge")] = {
      call: (method, args) => f.invoke(method, args),
    };
    const cua = await setupComputerUseRuntime({ globals });
    const app = await cua.getApp("TextEdit");
    await assert.rejects(app.setValue(0, "not observed"), /Observe this app/);
    await app.getAXState();
    await app.setValue(0, "approved value");
    assert.equal(f.calls.length, 1);
    await assert.rejects(app.getScreenshot(), /Screenshots/);
  } finally {
    await f.runtime.dispose();
  }
});
test("close and stop revoke requests before their first admission microtask", async () => {
  for (const operation of ["close", "stop"]) {
    const f = fixture({ getAppState: async () => assert.fail("revoked request reached backend") });
    try {
      const queued = f.invoke("get_app_state", { app_ref });
      if (operation === "close") await f.runtime.closeSession(context);
      else await f.invoke("stop_computer_control");
      assert.equal((await queued).structuredContent.code, "CONTROL_STOPPED");
    } finally {
      await f.runtime.dispose();
    }
  }
});
