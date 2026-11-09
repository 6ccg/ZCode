import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isRealComputerUseProducerInstalled,
  readComputerUseProducer,
  isWindowsComputerUseHelperEnabled,
  stageWindowsComputerUseRuntime,
} from "../scripts/computer-use-producer.mjs";
import { stageDevCuaPluginRuntime } from "../../../scripts/stage-dev-cua-plugin-runtime.mjs";

const roots: string[] = [];

function createWorkspace(cuaManifest: Record<string, unknown> | null) {
  const root = mkdtempSync(join(tmpdir(), "zcode-cua-producer-"));
  roots.push(root);
  const desktopRoot = join(root, "packages", "desktop");
  mkdirSync(desktopRoot, { recursive: true });
  if (cuaManifest) {
    const cuaDir = join(root, "node_modules", "@zcode", "zcode-cua");
    mkdirSync(cuaDir, { recursive: true });
    writeFileSync(join(cuaDir, "package.json"), JSON.stringify(cuaManifest));
  }
  return desktopRoot;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("../scripts/computer-use-producer.mjs");
  vi.doUnmock("../../../scripts/spawn-command.mjs");
  vi.resetModules();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("Computer Use producer detection", () => {
  it("真实 producer：已安装且未声明占位", () => {
    const desktopRoot = createWorkspace({ name: "@zcode/zcode-cua", version: "0.6.4" });
    expect(readComputerUseProducer({ desktopPackageRoot: desktopRoot })).toMatchObject({
      installed: true,
      placeholder: false,
    });
    expect(isRealComputerUseProducerInstalled({ desktopPackageRoot: desktopRoot })).toBe(true);
  });

  it("开源占位包：声明 zcodeCuaPlaceholder 时不算真实 producer", () => {
    const desktopRoot = createWorkspace({ name: "@zcode/zcode-cua", zcodeCuaPlaceholder: true });
    expect(readComputerUseProducer({ desktopPackageRoot: desktopRoot })).toMatchObject({
      installed: true,
      placeholder: true,
    });
    expect(isRealComputerUseProducerInstalled({ desktopPackageRoot: desktopRoot })).toBe(false);
  });

  it("未安装任何 producer 时不算真实 producer", () => {
    const desktopRoot = createWorkspace(null);
    expect(readComputerUseProducer({ desktopPackageRoot: desktopRoot }).installed).toBe(false);
    expect(isRealComputerUseProducerInstalled({ desktopPackageRoot: desktopRoot })).toBe(false);
  });

  it("占位包下 dev 插件运行时暂存直接跳过，不要求 sharp 与插件清单", () => {
    const desktopRoot = createWorkspace({ name: "@zcode/zcode-cua", zcodeCuaPlaceholder: true });
    expect(
      stageDevCuaPluginRuntime({
        env: { ZCODE_CUA_DEV_MODE: "1" },
        desktopPackageRoot: desktopRoot,
        pluginRoot: join(desktopRoot, "missing-plugin"),
      }),
    ).toEqual([]);
  });
});

describe("Windows source broker helper eligibility", () => {
  it("requires explicit helper input without changing legacy producer identity", () => {
    const desktopPackageRoot = createWorkspace({
      zcodeCuaPlaceholder: true,
      zcodeCuaRuntimeCapabilities: { windowsBroker: true },
    });
    const enabled = (platform: string, env: Record<string, string>) =>
      isWindowsComputerUseHelperEnabled({
        desktopPackageRoot,
        platform,
        env: { ZCODE_CUA_RUNTIME_PACKAGE_DIR: "/explicit-runtime", ...env },
      });
    expect(isRealComputerUseProducerInstalled({ desktopPackageRoot })).toBe(false);
    expect(enabled("win32", {})).toBe(false);
    expect(
      enabled("win32", { ZCODE_CUA_RUNTIME_PACKAGE_DIR: "", ZCODE_CUA_DEV_ROOT: "/helper" }),
    ).toBe(false);
    expect(enabled("win32", { ZCODE_CUA_DEV_ROOT: "   " })).toBe(false);
    for (const key of ["ZCODE_CUA_DEV_ROOT", "ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR"]) {
      expect(enabled("win32", { [key]: "/explicit-helper" })).toBe(true);
      expect(enabled("linux", { [key]: "/explicit-helper" })).toBe(false);
      expect(enabled("darwin", { [key]: "/explicit-helper" })).toBe(false);
    }
    expect(
      stageDevCuaPluginRuntime({
        desktopPackageRoot,
        platform: "win32",
        env: { ZCODE_CUA_DEV_MODE: "1" },
        pluginRoot: join(desktopPackageRoot, "missing-plugin"),
      }),
    ).toEqual([]);
  });

  it("does not treat helper input alone or truthy metadata as a source broker", () => {
    for (const manifest of [
      null,
      { zcodeCuaPlaceholder: true },
      {
        zcodeCuaPlaceholder: true,
        zcodeCuaRuntimeCapabilities: { windowsBroker: "true" },
      },
    ]) {
      const desktopPackageRoot = createWorkspace(manifest);
      expect(
        isWindowsComputerUseHelperEnabled({
          desktopPackageRoot,
          platform: "win32",
          env: { ZCODE_CUA_DEV_ROOT: "/explicit-helper" },
        }),
      ).toBe(false);
    }
  });

  it("retains legacy Windows defaults but never enables other targets", () => {
    const desktopPackageRoot = createWorkspace({ name: "@zcode/zcode-cua" });
    expect(
      isWindowsComputerUseHelperEnabled({ desktopPackageRoot, platform: "win32", env: {} }),
    ).toBe(true);
    expect(
      isWindowsComputerUseHelperEnabled({ desktopPackageRoot, platform: "linux", env: {} }),
    ).toBe(false);
  });
});

describe("external Windows runtime staging", () => {
  it("rejects npm dependencies and preserves supplied notices", async () => {
    const options = runtimeFixture();
    writeFileSync(join(options.sourceRoot, "LICENSE"), "fixture license");
    await stageWindowsComputerUseRuntime(options);
    expect(existsSync(join(options.outputDir, "LICENSE"))).toBe(true);
    writeFileSync(
      join(options.sourceRoot, "package.json"),
      JSON.stringify({
        name: "@zcode/zcode-cua",
        type: "module",
        version: "0.6.3",
        dependencies: { external: "1" },
      }),
    );
    await expect(stageWindowsComputerUseRuntime(options)).rejects.toThrow(
      "declared npm dependencies",
    );
  });

  function runtimeFixture() {
    const desktopRoot = createWorkspace(null);
    const sourceRoot = join(desktopRoot, "input");
    mkdirSync(sourceRoot);
    const exports = Object.fromEntries(
      [
        ".",
        "./frame-contract",
        "./host-display-contract",
        "./request-access-contract",
        "./pip-session",
        "./pip-session/node",
        "./broker",
        "./broker/server",
        "./broker/ports",
        "./broker/socketPath",
        "./broker/helperConstants",
        "./broker/helperHealth",
      ].map((name) => [name, { import: "./index.js" }]),
    );
    writeFileSync(
      join(sourceRoot, "package.json"),
      JSON.stringify({
        name: "@zcode/zcode-cua",
        type: "module",
        version: "0.6.3",
        exports,
      }),
    );
    writeFileSync(join(sourceRoot, "index.js"), "throw new Error('must not execute');");
    return { sourceRoot, outputDir: join(desktopRoot, "output") };
  }

  it.each([
    'import "./missing.js";',
    'export * from "../outside.js";',
    'import "undeclared-dependency";',
    'import("undeclared-dependency");',
    'require("undeclared-dependency");',
    'import { createRequire as cr } from "node:module"; const localRequire = cr(import.meta.url); localRequire("undeclared-dependency");',
    'const name = "node:fs"; import(name);',
    'const name = "node:fs"; require(name);',
  ])("rejects unresolved or unprovable import graphs: %s", async (source) => {
    const options = runtimeFixture();
    writeFileSync(join(options.sourceRoot, "index.js"), source);
    await expect(stageWindowsComputerUseRuntime(options)).rejects.toThrow();
    expect(existsSync(options.outputDir)).toBe(false);
  });

  it("accepts contained transitive imports and Node builtins without evaluating codegen strings", async () => {
    const options = runtimeFixture();
    writeFileSync(
      join(options.sourceRoot, "index.js"),
      'export * from "./child.js"; import("node:fs");',
    );
    writeFileSync(
      join(options.sourceRoot, "child.js"),
      'import { createRequire as cr } from "node:module"; const r = cr(import.meta.url); r("path"); const code = `require("ajv")`;',
    );
    await stageWindowsComputerUseRuntime(options);
    writeFileSync(join(options.sourceRoot, "child.js"), 'export * from "./gone.js";');
    await expect(stageWindowsComputerUseRuntime(options)).rejects.toThrow("gone.js");
  });

  it("does not claim optional or computed host dependencies are in the static ESM closure", async () => {
    const options = runtimeFixture();
    writeFileSync(
      join(options.sourceRoot, "index.js"),
      `
      import { createRequire as cr } from "node:module";
      const hostRequire = cr(import.meta.url);
      try { hostRequire("optional-host-module"); } catch {}
      const load = (name) => hostRequire(name);
      const generated = 'require("not-an-actual-import")';
    `,
    );
    await stageWindowsComputerUseRuntime(options);
  });

  it.each([undefined, "", "   ", 123])(
    "rejects missing or invalid runtime version: %s",
    async (version) => {
      const options = runtimeFixture();
      writeFileSync(
        join(options.sourceRoot, "package.json"),
        JSON.stringify({
          ...JSON.parse(readFileSync(join(options.sourceRoot, "package.json"), "utf8")),
          version,
        }),
      );
      await expect(stageWindowsComputerUseRuntime(options)).rejects.toThrow("version");
    },
  );

  it.each(["././index.js", ".//index.js", "./parent/../index.js"])(
    "rejects noncanonical public export %s",
    async (target) => {
      const options = runtimeFixture();
      const manifest = JSON.parse(readFileSync(join(options.sourceRoot, "package.json"), "utf8"));
      manifest.exports["."].import = target;
      writeFileSync(join(options.sourceRoot, "package.json"), JSON.stringify(manifest));
      await expect(stageWindowsComputerUseRuntime(options)).rejects.toThrow("contained JS export");
    },
  );

  it("copies runtime JS without executing it or copying declarations", async () => {
    const options = runtimeFixture();
    writeFileSync(join(options.sourceRoot, "index.d.ts"), "export {};");
    await stageWindowsComputerUseRuntime(options);
    expect(existsSync(join(options.outputDir, "index.js"))).toBe(true);
    expect(existsSync(join(options.outputDir, "index.d.ts"))).toBe(false);
  });

  it("rejects native files, symlinks and escaping export targets", async () => {
    for (const kind of ["native", "symlink", "escape"]) {
      const options = runtimeFixture();
      if (kind === "native") writeFileSync(join(options.sourceRoot, "helper.node"), "MZ");
      if (kind === "symlink")
        symlinkSync(join(options.sourceRoot, "index.js"), join(options.sourceRoot, "alias.js"));
      if (kind === "escape")
        writeFileSync(
          join(options.sourceRoot, "package.json"),
          JSON.stringify({
            name: "@zcode/zcode-cua",
            type: "module",
            version: "0.6.3",
            exports: { ".": { import: "../outside.js" } },
          }),
        );
      await expect(stageWindowsComputerUseRuntime(options)).rejects.toThrow();
      expect(existsSync(options.outputDir)).toBe(false);
    }
  });
});

describe("Windows helper build gate wiring", () => {
  it.each(["win32", "linux", "darwin"])(
    "keeps preparation and packaging consistent for %s",
    async (platform) => {
      const desktopPackageRoot = createWorkspace({
        zcodeCuaPlaceholder: true,
        zcodeCuaRuntimeCapabilities: { windowsBroker: true },
      });
      vi.stubEnv("ZCODE_TARGET_OS", platform);
      vi.stubEnv("ZCODE_TARGET_ARCH", "x64");
      vi.stubEnv("ZCODE_CUA_RUNTIME_PACKAGE_DIR", "/supplied-js");
      vi.stubEnv("ZCODE_CUA_DEV_ROOT", "/supplied-helper");
      const stageRuntime = vi.fn();
      vi.doMock("../scripts/computer-use-producer.mjs", () => ({
        isRealComputerUseProducerInstalled: () => false,
        isWindowsComputerUseHelperEnabled: (options: { platform: string }) =>
          isWindowsComputerUseHelperEnabled({ ...options, desktopPackageRoot }),
        stageWindowsComputerUseRuntime: stageRuntime,
        verifyWindowsComputerUseRuntime: vi.fn(),
      }));
      const runCommand = vi.fn();
      vi.doMock("../../../scripts/spawn-command.mjs", async (importOriginal) => ({
        ...(await importOriginal<typeof import("../../../scripts/spawn-command.mjs")>()),
        runCommand,
      }));
      await import("../scripts/prepare-runtime-assets.mjs");
      expect(
        runCommand.mock.calls.some((call) => call[1][0] === "prepare:windows-cua-helper"),
      ).toBe(platform === "win32");
      expect(stageRuntime).toHaveBeenCalledTimes(platform === "win32" ? 1 : 0);
      const { default: config } = await import("../electron-builder.config.js");
      const resources = config.extraResources as Array<{ to?: string }>;
      expect(resources.some((entry) => entry.to === "tools/cua-helper")).toBe(platform === "win32");
      expect(resources.some((entry) => entry.to === "tools/zcode-cua")).toBe(platform === "win32");
      expect(resources.some((entry) => entry.to?.startsWith("cua-helper/"))).toBe(false);
    },
  );
});
