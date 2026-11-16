import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";

const source = await readFile(
  new URL("../../services/src/cua-permission-broker/windowsCuaDevRuntime.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { resolveWindowsCuaRuntime } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t, packaged = false) {
  const temp = await mkdtemp(join(tmpdir(), "cua-resolver-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = packaged ? join(temp, "tools/cua-helper") : temp;
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, "build/Release"), { recursive: true });
  const entry = "// fixture only, never executed";
  const addon = Buffer.alloc(256);
  addon.write("MZ");
  addon.writeUInt32LE(128, 60);
  addon.write("PE\0\0", 128);
  addon.writeUInt16LE(0x8664, 132);
  const manifest = {
    schemaVersion: 1,
    packageName: "@zcode/zcode-cua",
    packageVersion: "0.6.4",
    platform: "win32",
    arch: "x64",
    electronVersion: "41.0.3",
    entry: "dist/windows-helper.js",
    addon: "build/Release/ax_native.node",
    sha256: { entry: hash(entry), addon: hash(addon) },
  };
  const pkg = {
    name: "@zcode/zcode-cua-helper-runtime",
    version: "0.6.4",
    type: "module",
    main: manifest.entry,
  };
  await writeFile(join(root, manifest.entry), entry);
  await writeFile(join(root, manifest.addon), addon);
  const save = async () => {
    await writeFile(join(root, "package.json"), JSON.stringify(pkg));
    await writeFile(join(root, "runtime-manifest.json"), JSON.stringify(manifest));
  };
  await save();
  const options = {
    platform: "win32",
    arch: "x64",
    electronVersion: "41.0.3",
    env: packaged ? {} : { ZCODE_CUA_DEV_ROOT: root },
    resourcesPath: temp,
  };
  return {
    root,
    pkg,
    manifest,
    addon,
    save,
    resolve: (extra = {}) => resolveWindowsCuaRuntime({ ...options, ...extra }),
  };
}
test("prebuilt root and packaged resources preserve truthful provenance", async (t) => {
  for (const packaged of [false, true]) {
    const f = await fixture(t, packaged);
    const r = await f.resolve();
    assert.equal(r.source, packaged ? "packaged" : "development-prebuilt");
    assert.equal(r.command, process.execPath);
    assert.deepEqual(r.commandEnv, { ELECTRON_RUN_AS_NODE: "1" });
  }
});
test("source producer contract remains supported", async (t) => {
  const f = await fixture(t);
  f.pkg.name = "@zcode/zcode-cua";
  f.pkg.zcodeCuaRuntime = {
    schema: 1,
    windows: { entry: f.manifest.entry, nativeAddon: f.manifest.addon },
  };
  await f.save();
  assert.equal((await f.resolve()).source, "development-source");
});
test("prebuilt rejects invalid package metadata without fallback", async (t) => {
  for (const change of [
    { name: "untrusted" },
    { version: "0.0.0" },
    { main: "wrong.js" },
    { type: "commonjs" },
  ]) {
    const f = await fixture(t);
    Object.assign(f.pkg, change);
    await f.save();
    await assert.rejects(f.resolve(), { reason: "invalid-package" });
  }
});
test("prebuilt rejects bad manifests, hashes and PE machines", async (t) => {
  for (const change of [
    { extra: true },
    { arch: "arm64" },
    { electronVersion: "40.0.0" },
    { entry: "../outside.js" },
  ]) {
    const f = await fixture(t);
    Object.assign(f.manifest, change);
    await f.save();
    await assert.rejects(f.resolve());
  }
  const f = await fixture(t);
  await writeFile(join(f.root, f.manifest.entry), "changed");
  await assert.rejects(f.resolve(), { reason: "artifact-integrity-mismatch" });
  const bad = await fixture(t);
  bad.addon.writeUInt16LE(0xaa64, 132);
  bad.manifest.sha256.addon = hash(bad.addon);
  await bad.save();
  await writeFile(join(bad.root, bad.manifest.addon), bad.addon);
  await assert.rejects(bad.resolve(), {
    reason: "incompatible-runtime-manifest",
  });
});
test("prebuilt rejects symbolic artifacts and manifests", async (t) => {
  for (const artifact of ["dist/windows-helper.js", "runtime-manifest.json", "package.json"]) {
    const f = await fixture(t);
    const path = join(f.root, artifact);
    const bytes = await readFile(path);
    await writeFile(join(f.root, "other"), bytes);
    await rm(path);
    await symlink(join(f.root, "other"), path);
    await assert.rejects(f.resolve());
  }
});

test("arm64 manifest requires matching PE bytes", async (t) => {
  const f = await fixture(t);
  f.manifest.arch = "arm64";
  f.addon.writeUInt16LE(0xaa64, 132);
  f.manifest.sha256.addon = hash(f.addon);
  await f.save();
  await writeFile(join(f.root, f.manifest.addon), f.addon);
  assert.equal((await f.resolve({ arch: "arm64" })).source, "development-prebuilt");
});
test("PE validation rejects malformed headers even with matching hashes", async (t) => {
  for (const malformed of [Buffer.alloc(0), Buffer.alloc(64), Buffer.from("not a binary")]) {
    const f = await fixture(t);
    f.manifest.sha256.addon = hash(malformed);
    await f.save();
    await writeFile(join(f.root, f.manifest.addon), malformed);
    await assert.rejects(f.resolve(), { reason: "incompatible-runtime-manifest" });
  }
});
test("canonical manifest paths reject Windows traversal and alternate streams", async (t) => {
  for (const entry of ["C:/escape.js", "dist/../escape.js", "dist/file:stream", "dist\\file.js"]) {
    const f = await fixture(t);
    f.manifest.entry = entry;
    f.pkg.main = entry;
    await f.save();
    await assert.rejects(f.resolve());
  }
});
test("explicit root never falls back and never resolves on Linux", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.resolve({ env: { ZCODE_CUA_DEV_ROOT: "relative" } }), {
    reason: "development-root-not-absolute",
  });
  await assert.rejects(f.resolve({ platform: "linux" }), { reason: "unsupported-platform" });
  await rm(join(f.root, "runtime-manifest.json"));
  await assert.rejects(f.resolve(), { reason: "invalid-runtime-manifest" });
});

test("helper runtime alias takes priority and invalid input never falls back", async (t) => {
  const high = await fixture(t);
  const low = await fixture(t);
  const env = { ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: high.root, ZCODE_CUA_DEV_ROOT: low.root };
  assert.equal((await high.resolve({ env })).root, high.root);
  await assert.rejects(
    high.resolve({ env: { ...env, ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: "relative" } }),
    {
      reason: "development-root-not-absolute",
      message: "ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR must be an absolute path.",
    },
  );
  await rm(join(high.root, "runtime-manifest.json"));
  await assert.rejects(high.resolve({ env }), { reason: "invalid-runtime-manifest" });
  assert.equal(
    (await high.resolve({ env: { ...env, ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: "  " } })).root,
    low.root,
  );
});
