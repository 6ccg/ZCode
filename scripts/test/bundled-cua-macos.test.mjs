import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { patchMacHelper } from "../bundled-cua.mjs";

test("Mac SEA adaptation preserves layout and requires Host authority for tool and presentation", () => {
  const input = Buffer.from(
    "var allowUnsignedLauncherLocalDev = false; class Broker { handleAuthenticate(conn, request) { /*" +
      " ".repeat(1600) +
      '*/ return "old"; } }',
  );
  const output = patchMacHelper(input);
  assert.equal(output.length, input.length);
  const Broker = new Function(
    "process",
    "parseConnectionIdentity",
    "errorResponse",
    "okResponse",
    output.toString() + "; return Broker;",
  )(
    { env: { ZCODE_CUA_PLUGIN_AUTHORITY: "host-authority-0123456789" } },
    () => ({}),
    (_id, code) => code,
    (_id, value) => value,
  );
  const broker = new Broker();
  broker.markConnectionAuthenticated = () => {};
  broker.peerPresentationEligible = () => false;
  assert.equal(broker.handleAuthenticate({}, { id: 0, params: {} }), "not_authorized");
  assert.equal(
    broker.handleAuthenticate({}, { id: 0, params: { pluginAuthority: "wrong" } }),
    "not_authorized",
  );
  const params = { pluginAuthority: "host-authority-0123456789" };
  assert.equal(broker.handleAuthenticate({}, { id: 0, params }).authenticated, true);
  assert.equal(
    broker.handleAuthenticate(
      { peerVerdict: {} },
      { id: 0, params: { ...params, role: "presentation" } },
    ),
    "not_authorized",
  );
  broker.peerPresentationEligible = () => true;
  assert.equal(
    broker.handleAuthenticate(
      { peerVerdict: {} },
      { id: 0, params: { ...params, role: "presentation" } },
    ).role,
    "presentation",
  );
  assert.throws(() => patchMacHelper(Buffer.from("changed version")), /input changed/);
});

test("Mac Host serializes concurrent starts and drains the owned PID before restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "mac-cua-host-"));
  try {
    await writeFile(
      join(root, "host.mjs"),
      await readFile(new URL("../cua-runtime-adapter/host-macos.js", import.meta.url)),
    );
    await writeFile(
      join(root, "broker.js"),
      'export const mintBrokerSocketPath=()=>"/tmp/test.sock";export const probeHelperHealth=()=>{};export const callBrokerMethod=()=>{};',
    );
    const { createProductCuaHelperHost } = await import(pathToFileURL(join(root, "host.mjs")));
    let launches = 0,
      alive = true;
    const host = createProductCuaHelperHost({
      pluginAuthority: "host-authority-0123456789",
      helperInstaller: { ensureInstalled: async () => "/app/Helper.app" },
      execute: async (_command, args) => {
        launches++;
        alive = true;
        assert.ok(args.includes("--env"));
        assert.ok(args.includes("ZCODE_CUA_PLUGIN_AUTHORITY=host-authority-0123456789"));
      },
      probe: async () => ({ pid: 100 + launches, bundleId: "test" }),
      signalProcess: (_pid, signal) => {
        if (!alive) throw Object.assign(new Error(), { code: "ESRCH" });
        assert.ok(signal === 0 || signal === "SIGTERM");
      },
      delay: async () => {
        alive = false;
      },
    });
    const [a, b] = await Promise.all([host.start(), host.start()]);
    assert.equal(a, b);
    assert.equal(launches, 1);
    const restarted = await host.restart();
    assert.equal(restarted.pid, 102);
    assert.equal(launches, 2);
    await host.stop();
    assert.equal(host.running, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
