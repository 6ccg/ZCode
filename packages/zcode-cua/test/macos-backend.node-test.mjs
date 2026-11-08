import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createMacOSBackend } from "../src/macos-backend.js";

function fixture({ cancel = false, onConsent, failExec = false } = {}) {
  const calls = [],
    prompts = [],
    writes = [];
  let value = "before";
  const attr = {
    settable: () => true,
    set value(v) {
      writes.push(v);
      value = v;
    },
  };
  const attributes = () => [{ name: () => "AXValue" }];
  attributes.byName = () => attr;
  const windowAttributes = () => [];
  windowAttributes.byName = () => ({ settable: () => false });
  const field = {
    role: () => "AXTextField",
    subrole: () => "",
    name: () => "Name",
    value: () => value,
    actions: () => [],
    attributes,
    uiElements: () => [],
  };
  const win = {
    role: () => "AXWindow",
    subrole: () => "",
    name: () => "Document",
    value: () => "",
    actions: () => [],
    attributes: windowAttributes,
    uiElements: () => [field],
  };
  const proc = {
    name: () => "TextEdit",
    unixId: () => 42,
    bundleIdentifier: () => "com.apple.TextEdit",
    backgroundOnly: () => false,
    frontmost: () => true,
    windows: () => [win],
  };
  const se = { applicationProcesses: () => [proc] };
  const ui = {
    displayDialog(message) {
      prompts.push(message);
      if (cancel) throw Error("cancel");
      onConsent?.(prompts.length, { field, proc });
    },
  };
  function Application(name) {
    assert.equal(name, "System Events");
    return se;
  }
  Application.currentApplication = () => ui;
  const execFile = async (file, argv, options) => {
    calls.push({ file, argv, options });
    if (failExec) throw Error("killed");
    const native = vm.runInNewContext(argv[3] + "\nrun", { Application });
    return { stdout: native([argv[5]]) };
  };
  return {
    backend: createMacOSBackend({ platform: "darwin", execFile }),
    calls,
    prompts,
    writes,
    field,
    proc,
  };
}
const args = { app_ref: { pid: 42 } };

test("unsupported platform, remote, screenshots and unsupported mutations never execute", async () => {
  let calls = 0;
  const backend = createMacOSBackend({
    platform: "linux",
    execFile: async () => {
      calls++;
    },
  });
  await assert.rejects(backend.listApps(), { code: "unimplemented" });
  const f = fixture();
  await assert.rejects(f.backend.listApps({ remoteSessionId: "remote" }), {
    code: "not_authorized",
  });
  await assert.rejects(f.backend.getAppState({ ...args, include_screenshot: true }), {
    code: "unimplemented",
  });
  await assert.rejects(f.backend.act("key", args), { code: "unimplemented" });
  assert.equal(calls + f.calls.length, 0);
});

test("observation is consent-gated; executable source never contains supplied text", async () => {
  const f = fixture();
  const state = await f.backend.getAppState(args);
  assert.equal(state.elements[1].title, "Name");
  assert.equal(f.prompts.length, 1);
  const value = '"; doShellScript("bad"); //';
  await f.backend.act(
    "set_value",
    { ...args, target: { type: "element", index: 1 }, value },
    {},
    state.backendState,
  );
  assert.deepEqual(f.writes, [value]);
  assert.equal(f.calls[1].file, "/usr/bin/osascript");
  assert.equal(f.calls[1].argv[3].includes(value), false);
  assert.match(f.prompts[1], /Set value to:/);
});

test("cancelled observation never reads application inventory", async () => {
  const f = fixture({ cancel: true });
  f.proc.name = () => {
    throw Error("must not read");
  };
  await assert.rejects(f.backend.getAppState(args), {
    code: "permission_denied",
    actionSent: false,
  });
  assert.deepEqual(f.writes, []);
});

test("stale tree is rejected before action consent", async () => {
  const f = fixture();
  const state = await f.backend.getAppState(args);
  f.field.name = () => "Changed";
  await assert.rejects(
    f.backend.act(
      "set_value",
      { ...args, target: { type: "element", index: 1 }, value: "new" },
      {},
      state.backendState,
    ),
    { code: "element_unavailable", actionSent: false },
  );
  assert.equal(f.prompts.length, 1);
  assert.deepEqual(f.writes, []);
});

test("tree changed during consent is rejected immediately before dispatch", async () => {
  const f = fixture({
    onConsent: (count, { field }) => {
      if (count === 2) field.name = () => "Changed";
    },
  });
  const state = await f.backend.getAppState(args);
  await assert.rejects(
    f.backend.act(
      "set_value",
      { ...args, target: { type: "element", index: 1 }, value: "new" },
      {},
      state.backendState,
    ),
    { code: "element_unavailable", actionSent: false },
  );
  assert.deepEqual(f.writes, []);
});

test("protected value is never read and cannot be mutated", async () => {
  const f = fixture();
  f.field.subrole = () => "AXSecureTextField";
  f.field.value = () => {
    throw Error("secret must not be accessed");
  };
  const state = await f.backend.getAppState(args);
  assert.equal(state.elements[1].value, "[excluded]");
  await assert.rejects(
    f.backend.act(
      "set_value",
      { ...args, target: { type: "element", index: 1 }, value: "new" },
      {},
      state.backendState,
    ),
    { code: "not_authorized" },
  );
});

test("permission applications excluded; foreground changes rejected", async () => {
  const f = fixture();
  f.proc.name = () => "System Settings";
  await assert.rejects(f.backend.getAppState(args), { code: "not_authorized" });
  f.proc.name = () => "TextEdit";
  f.proc.frontmost = () => false;
  await assert.rejects(f.backend.getAppState(args), { code: "foreground_required" });
});

test("lost subprocess receipt marks action outcome uncertain without retry", async () => {
  const f = fixture({ failExec: true });
  await assert.rejects(f.backend.act("set_value", args), { code: "internal", actionSent: true });
  assert.equal(f.calls.length, 1);
});

test("only advertised actions dispatch; permission dialog descendants excluded", async () => {
  const f = fixture();
  let performed = 0;
  const actions = () => [{ name: () => "AXPress" }];
  actions.byName = (name) => ({
    perform: () => {
      assert.equal(name, "AXPress");
      performed++;
    },
  });
  f.field.actions = actions;
  let state = await f.backend.getAppState(args);
  await assert.rejects(
    f.backend.act(
      "perform_action",
      { ...args, target: { type: "element", index: 1 }, action: "AXDelete" },
      {},
      state.backendState,
    ),
    { code: "action_unavailable" },
  );
  await f.backend.act(
    "perform_action",
    { ...args, target: { type: "element", index: 1 }, action: "AXPress" },
    {},
    state.backendState,
  );
  assert.equal(performed, 1);
  f.field.role = () => "AXSheet";
  state = await f.backend.getAppState(args);
  await assert.rejects(
    f.backend.act(
      "perform_action",
      { ...args, target: { type: "element", index: 1 }, action: "AXPress" },
      {},
      state.backendState,
    ),
    { code: "not_authorized" },
  );
  assert.equal(performed, 1);
});

test("cancelled mutation never dispatches", async () => {
  const f = fixture({
    onConsent: (count) => {
      if (count === 2) throw Error("cancel");
    },
  });
  const state = await f.backend.getAppState(args);
  await assert.rejects(
    f.backend.act(
      "set_value",
      { ...args, target: { type: "element", index: 1 }, value: "new" },
      {},
      state.backendState,
    ),
    { code: "permission_denied", actionSent: false },
  );
  assert.deepEqual(f.writes, []);
});

test("window references fail before native call; text exposes bounded AX rows", async () => {
  const f = fixture();
  await assert.rejects(f.backend.getAppState({ app_ref: { pid: 42, window_id: "window-2" } }), {
    code: "unimplemented",
  });
  assert.equal(f.calls.length, 0);
  const state = await f.backend.getAppState(args);
  assert.match(f.prompts[0], /Target:.*42/);
  assert.match(state.text, /\[1\] AXTextField "Name" value="before"/);
  f.field.value = () => "x".repeat(600);
  const bounded = await f.backend.getAppState(args);
  assert.equal(bounded.elements[1].value.length, 512);
  assert.equal(bounded.backendState.incomplete, true);
  await assert.rejects(
    f.backend.act(
      "set_value",
      { ...args, target: { type: "element", index: 1 }, value: "new" },
      {},
      bounded.backendState,
    ),
    { code: "element_unavailable" },
  );
});

test("focus changed during final AX traversal rejects dispatch", async () => {
  let foreground = true;
  const f = fixture({
    onConsent: (count, { field, proc }) => {
      if (count === 2) {
        proc.frontmost = () => foreground;
        field.uiElements = () => {
          foreground = false;
          return [];
        };
      }
    },
  });
  const state = await f.backend.getAppState(args);
  await assert.rejects(
    f.backend.act(
      "set_value",
      { ...args, target: { type: "element", index: 1 }, value: "new" },
      {},
      state.backendState,
    ),
    { code: "foreground_required", actionSent: false },
  );
  assert.deepEqual(f.writes, []);
});

test("unknown protection metadata never reads a value or permits mutation", async () => {
  for (const variant of ["subrole", "protection", "enumeration"]) {
    const f = fixture();
    let reads = 0;
    f.field.value = () => {
      reads++;
      return "secret";
    };
    if (variant === "subrole")
      f.field.subrole = () => {
        throw Error("unreadable");
      };
    if (variant === "protection")
      f.field.attributes = () => [
        {
          name: () => "AXProtectedContent",
          value: () => {
            throw Error("unreadable");
          },
        },
      ];
    if (variant === "enumeration")
      f.field.attributes = () => {
        throw Error("unreadable");
      };
    const state = await f.backend.getAppState(args);
    assert.equal(reads, 0, variant);
    assert.equal(state.elements[1].excluded, true, variant);
    await assert.rejects(
      f.backend.act(
        "set_value",
        { ...args, target: { type: "element", index: 1 }, value: "new" },
        {},
        state.backendState,
      ),
      { code: "not_authorized" },
    );
    assert.equal(reads, 0, variant);
    assert.deepEqual(f.writes, []);
  }
});
