import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  finalizePackagedWindowsCuaHelper,
  prepareWindowsCuaHelperAssets,
  verifyPackagedWindowsCuaHelper,
} from "../scripts/windows-cua-helper-assets.mjs";

const roots: string[] = [];
const targetPlatform = { os: "win32", arch: "x64", key: "win32-x64" };
const electronVersion = "41.0.3";
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

async function fixture(prebuilt = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "zcode-prebuilt-cua-")));
  roots.push(root);
  const sourceRoot = join(root, "input");
  const outputRoot = join(root, "output");
  const entry = "dist/windows-helper.js";
  const addon = "build/Release/ax_native.node";
  const entryBytes = Buffer.from(
    "// Fixture only. Existing helper connection policy stays unchanged.\n",
  );
  const addonBytes = Buffer.alloc(128);
  addonBytes.write("MZ");
  addonBytes.writeUInt32LE(64, 0x3c);
  addonBytes.write("PE\0\0", 64);
  addonBytes.writeUInt16LE(0x8664, 68);
  await mkdir(join(sourceRoot, "dist"), { recursive: true });
  await mkdir(join(sourceRoot, "build/Release"), { recursive: true });
  await writeFile(join(sourceRoot, entry), entryBytes);
  await writeFile(join(sourceRoot, addon), addonBytes);
  const manifest = {
    schemaVersion: 1,
    packageName: "@zcode/zcode-cua",
    packageVersion: "0.6.4",
    platform: "win32",
    arch: "x64",
    electronVersion,
    entry,
    addon,
    sha256: { entry: sha256(entryBytes), addon: sha256(addonBytes) },
  };
  const packageJson = {
    name: prebuilt ? "@zcode/zcode-cua-helper-runtime" : "@zcode/zcode-cua",
    version: manifest.packageVersion,
    type: "module",
    main: entry,
    ...(prebuilt ? {} : { zcodeCuaRuntime: { schema: 1, windows: { entry, nativeAddon: addon } } }),
  };
  await writeFile(join(sourceRoot, "package.json"), JSON.stringify(packageJson));
  await writeFile(join(sourceRoot, "runtime-manifest.json"), JSON.stringify(manifest));
  for (const name of [
    "express",
    "sharp",
    "detect-libc",
    "semver",
    "@img/colour",
    "@img/sharp-win32-x64",
  ]) {
    const dir = join(sourceRoot, "node_modules", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
    );
    await writeFile(join(dir, "index.js"), "module.exports = {};\n");
  }
  const options = { sourceRoot, outputRoot, targetPlatform, electronVersion };
  return { root, ...options, options, entryBytes, addonBytes, manifest, packageJson };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Windows prebuilt CUA resource adapter (static fixtures, no native execution)", () => {
  it.each([false, true])(
    "stages source/prebuilt=%s without changing helper bytes",
    async (prebuilt) => {
      const f = await fixture(prebuilt);
      const result = await prepareWindowsCuaHelperAssets(f.options);
      expect(result.status).toBe("staged");
      expect(result.manifest).toEqual(f.manifest);
      expect(await readFile(join(result.outputDir, f.manifest.entry))).toEqual(f.entryBytes);
      expect(await readFile(join(result.outputDir, f.manifest.addon))).toEqual(f.addonBytes);
      const resourcesDir = join(f.root, "resources");
      await mkdir(join(resourcesDir, "tools"), { recursive: true });
      await cp(result.outputDir, join(resourcesDir, "tools/cua-helper"), { recursive: true });
      await expect(
        verifyPackagedWindowsCuaHelper({ resourcesDir, targetPlatform, electronVersion }),
      ).resolves.toMatchObject({ status: "verified", peMachine: 0x8664 });
    },
  );

  it("does not relabel an unverified Electron version or replace prior output", async () => {
    const f = await fixture();
    const outputDir = join(f.outputRoot, "win32-x64/cua-helper");
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "previous"), "keep");
    await expect(
      prepareWindowsCuaHelperAssets({ ...f.options, electronVersion: "44.7.0" }),
    ).rejects.toThrow(/native Windows validation required.*41\.0\.3.*44\.7\.0/u);
    expect(await readFile(join(outputDir, "previous"), "utf8")).toBe("keep");
    expect(JSON.parse(await readFile(join(f.sourceRoot, "runtime-manifest.json"), "utf8"))).toEqual(
      f.manifest,
    );
  });

  it.each(["entry", "addon"] as const)("rejects a changed %s hash", async (kind) => {
    const f = await fixture();
    await writeFile(join(f.sourceRoot, f.manifest[kind]), "tampered");
    await expect(prepareWindowsCuaHelperAssets(f.options)).rejects.toThrow(
      /SHA-256 hash mismatch/u,
    );
  });

  it.each([
    ["arch", "arm64", /runtime-manifest.json arch/u],
    ["entry", "../outside.js", /invalid entry path/u],
    ["entry", "dist/windows-helper.js:stream", /invalid entry path/u],
    ["packageVersion", "0.6.5", /same version/u],
  ])("rejects invalid manifest %s=%s", async (field, value, error) => {
    const f = await fixture();
    await writeFile(
      join(f.sourceRoot, "runtime-manifest.json"),
      JSON.stringify({ ...f.manifest, [String(field)]: value }),
    );
    if (field === "entry") {
      await writeFile(
        join(f.sourceRoot, "package.json"),
        JSON.stringify({ ...f.packageJson, main: value }),
      );
    }
    await expect(prepareWindowsCuaHelperAssets(f.options)).rejects.toThrow(error as RegExp);
  });

  it("rejects a mismatched PE machine even if its hash matches", async () => {
    const f = await fixture();
    f.addonBytes.writeUInt16LE(0xaa64, 68);
    f.manifest.sha256.addon = sha256(f.addonBytes);
    await writeFile(join(f.sourceRoot, f.manifest.addon), f.addonBytes);
    await writeFile(join(f.sourceRoot, "runtime-manifest.json"), JSON.stringify(f.manifest));
    await expect(prepareWindowsCuaHelperAssets(f.options)).rejects.toThrow(/PE machine mismatch/u);
  });

  it("requires the prebuilt main entry to agree with the manifest", async () => {
    const f = await fixture();
    await writeFile(
      join(f.sourceRoot, "package.json"),
      JSON.stringify({ ...f.packageJson, main: "other.js" }),
    );
    await expect(prepareWindowsCuaHelperAssets(f.options)).rejects.toThrow(/main.*manifest entry/u);
  });

  it("requires a self-contained dependency closure rather than using the build host", async () => {
    const f = await fixture();
    await rm(join(f.sourceRoot, "node_modules/express"), { recursive: true });
    await expect(prepareWindowsCuaHelperAssets(f.options)).rejects.toThrow(
      /missing runtime dependency: express/u,
    );
  });

  // Windows 文件符号链接需要额外系统权限；不为测试修改设置，目录 junction 用例仍执行。
  it.skipIf(process.platform === "win32")("rejects a linked helper artifact", async () => {
    const f = await fixture();
    const outside = join(f.root, "outside.js");
    await writeFile(outside, f.entryBytes);
    await rm(join(f.sourceRoot, f.manifest.entry));
    await symlink(outside, join(f.sourceRoot, f.manifest.entry));
    await expect(prepareWindowsCuaHelperAssets(f.options)).rejects.toThrow(
      /regular file.*symbolic link/u,
    );
  });

  it.skipIf(process.platform === "win32")(
    "does not dereference links inside prebuilt dependencies",
    async () => {
      const f = await fixture();
      const outside = join(f.root, "outside.js");
      await writeFile(outside, "must not enter the package");
      await symlink(outside, join(f.sourceRoot, "node_modules/express/linked.js"));
      await expect(prepareWindowsCuaHelperAssets(f.options)).rejects.toThrow(
        /linked or non-regular file/u,
      );
    },
  );

  it("copies the verified flat dependency rather than a nested resolver candidate", async () => {
    const f = await fixture();
    const expressRoot = join(f.sourceRoot, "node_modules/express");
    await writeFile(
      join(expressRoot, "package.json"),
      JSON.stringify({
        name: "express",
        version: "1.0.0",
        dependencies: { semver: "*" },
      }),
    );
    const nestedRoot = join(expressRoot, "node_modules/semver");
    await mkdir(nestedRoot, { recursive: true });
    await writeFile(
      join(nestedRoot, "package.json"),
      JSON.stringify({
        name: "semver",
        version: "9.9.9",
        main: "index.js",
      }),
    );
    await writeFile(join(nestedRoot, "index.js"), "not the verified flat dependency");
    const result = await prepareWindowsCuaHelperAssets(f.options);
    expect(await readFile(join(result.outputDir, "node_modules/semver/index.js"), "utf8")).toBe(
      "module.exports = {};\n",
    );
  });

  it("rejects a nested dependency link outside the prebuilt source root", async () => {
    const f = await fixture();
    const outside = join(f.root, "external-semver");
    await cp(join(f.sourceRoot, "node_modules/semver"), outside, { recursive: true });
    const nestedRoot = join(f.sourceRoot, "node_modules/express/node_modules");
    await mkdir(nestedRoot, { recursive: true });
    await symlink(outside, join(nestedRoot, "semver"), "junction");
    await expect(prepareWindowsCuaHelperAssets(f.options)).rejects.toThrow(
      /linked or non-regular file/u,
    );
  });

  it.each([verifyPackagedWindowsCuaHelper, finalizePackagedWindowsCuaHelper])(
    "cannot override the fixed packaged resource root via the prebuilt option",
    async (verify) => {
      const f = await fixture();
      await expect(
        verify({
          resourcesDir: f.root,
          prebuiltSourceRoot: f.sourceRoot,
          targetPlatform,
          electronVersion,
        }),
      ).rejects.toThrow(/packaged root is missing/u);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects dependency links introduced during staging without replacing output",
    async () => {
      const f = await fixture();
      const outside = join(f.root, "outside.js");
      await writeFile(outside, "must not enter the package");
      await expect(
        prepareWindowsCuaHelperAssets({
          ...f.options,
          afterArtifactSnapshot: async () => {
            await symlink(outside, join(f.sourceRoot, "node_modules/express/linked.js"));
          },
        }),
      ).rejects.toThrow(/linked or non-regular file/u);
      await expect(
        readFile(join(f.outputRoot, "win32-x64/cua-helper/runtime-manifest.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("rejects a linked dependency ancestor substituted after validation", async () => {
    const f = await fixture();
    await expect(
      prepareWindowsCuaHelperAssets({
        ...f.options,
        afterArtifactSnapshot: async () => {
          const modules = join(f.sourceRoot, "node_modules");
          const outside = join(f.root, "external-modules");
          await rename(modules, outside);
          await symlink(outside, modules, "junction");
        },
      }),
    ).rejects.toThrow(/physical path.*(not contained|mismatch)/u);
    await expect(
      readFile(join(f.outputRoot, "win32-x64/cua-helper/runtime-manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stages the verified snapshot if source bytes change afterward", async () => {
    const f = await fixture();
    const result = await prepareWindowsCuaHelperAssets({
      ...f.options,
      afterArtifactSnapshot: async () => {
        await writeFile(join(f.sourceRoot, f.manifest.entry), "changed after validation");
      },
    });
    expect(await readFile(join(result.outputDir, f.manifest.entry))).toEqual(f.entryBytes);
    expect(result.manifest.sha256.entry).toBe(sha256(f.entryBytes));
  });

  it("revalidates copied dependency metadata before replacing output", async () => {
    const f = await fixture();
    await expect(
      prepareWindowsCuaHelperAssets({
        ...f.options,
        afterArtifactSnapshot: async () => {
          await writeFile(
            join(f.sourceRoot, "node_modules/express/package.json"),
            JSON.stringify({ name: "not-express", version: "1.0.0" }),
          );
        },
      }),
    ).rejects.toThrow(/invalid runtime dependency metadata: express/u);
    await expect(
      readFile(join(f.outputRoot, "win32-x64/cua-helper/runtime-manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
