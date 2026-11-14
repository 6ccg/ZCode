import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isSharpRequiredByComputerUse,
  resolveSharpRuntimePackageNames,
  stageSharpIntoBundledAgents,
  verifyStagedSharp,
} from "../scripts/sharp-package-assets.mjs";
import { stageDevCuaPluginRuntime } from "../../../scripts/stage-dev-cua-plugin-runtime.mjs";

const roots: string[] = [];
const windowsSourceManifest = {
  name: "@zcode/zcode-cua",
  zcodeCuaPlaceholder: true,
  zcodeCuaRuntimeCapabilities: { windowsBroker: true },
};
const windowsRuntimeEnv = {
  ZCODE_CUA_RUNTIME_PACKAGE_DIR: "/explicit-runtime",
  ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: "/explicit-helper",
};

function createWorkspace(
  cuaManifest: Record<string, unknown> | null,
  location: "root" | "desktop",
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "zcode-sharp-cua-")));
  roots.push(root);
  const desktopRoot = join(root, "packages", "desktop");
  mkdirSync(desktopRoot, { recursive: true });
  if (cuaManifest) {
    const base = location === "root" ? root : desktopRoot;
    const cuaDir = join(base, "node_modules", "@zcode", "zcode-cua");
    mkdirSync(cuaDir, { recursive: true });
    writeFileSync(join(cuaDir, "package.json"), JSON.stringify(cuaManifest));
  }
  return desktopRoot;
}

function createSharpPackages(root: string, arch: string, marker = "synthetic fixture") {
  for (const name of resolveSharpRuntimePackageNames({ os: "win32", arch })) {
    const packageDir = join(root, "node_modules", name);
    mkdirSync(join(packageDir, "lib"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name, exports: { "./package": "./package.json" } }),
    );
    writeFileSync(
      join(packageDir, "lib", "index.js"),
      `throw new Error(${JSON.stringify(marker)});`,
    );
  }
  for (const name of ["sharp.node", "libvips-42.dll"]) {
    writeFileSync(join(root, "node_modules", "@img", `sharp-win32-${arch}`, "lib", name), marker);
  }
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("isSharpRequiredByComputerUse", () => {
  it.each(["dependencies", "optionalDependencies", "peerDependencies"])(
    "真实 Computer Use 包在 %s 声明 sharp 时需要暂存 sharp",
    (field) => {
      const desktopRoot = createWorkspace(
        { name: "@zcode/zcode-cua", [field]: { sharp: "^0.34.0" } },
        "root",
      );
      expect(isSharpRequiredByComputerUse({ desktopPackageRoot: desktopRoot })).toBe(true);
    },
  );

  it("不声明 sharp 的占位包不需要 sharp，优先读取离桌面包最近的安装", () => {
    const desktopRoot = createWorkspace(
      { name: "@zcode/zcode-cua", zcodeCuaPlaceholder: true },
      "desktop",
    );
    const hoistedDir = join(desktopRoot, "..", "..", "node_modules", "@zcode", "zcode-cua");
    mkdirSync(hoistedDir, { recursive: true });
    writeFileSync(
      join(hoistedDir, "package.json"),
      JSON.stringify({ dependencies: { sharp: "^0.34.0" } }),
    );
    expect(isSharpRequiredByComputerUse({ desktopPackageRoot: desktopRoot })).toBe(false);
  });

  it("找不到 Computer Use 包时不需要 sharp", () => {
    const desktopRoot = createWorkspace(null, "root");
    expect(isSharpRequiredByComputerUse({ desktopPackageRoot: desktopRoot })).toBe(false);
  });

  it.each(["x64", "arm64"])(
    "Windows %s source bridge requires plugin-local Sharp without declaring it",
    (arch) => {
      const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
      for (const helperKey of ["ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR", "ZCODE_CUA_DEV_ROOT"]) {
        expect(
          isSharpRequiredByComputerUse({
            desktopPackageRoot,
            targetPlatform: { os: "win32", arch },
            env: {
              ZCODE_CUA_RUNTIME_PACKAGE_DIR: "/external-runtime",
              [helperKey]: "/external-helper",
            },
          }),
        ).toBe(true);
      }
    },
  );

  it.each(["darwin", "linux", undefined])(
    "does not enable the source bridge for target %s",
    (os) => {
      const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
      expect(
        isSharpRequiredByComputerUse({
          desktopPackageRoot,
          targetPlatform: os ? { os, arch: "x64" } : undefined,
          env: windowsRuntimeEnv,
        }),
      ).toBe(false);
    },
  );

  it.each([
    {},
    { ZCODE_CUA_RUNTIME_PACKAGE_DIR: "/runtime" },
    { ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: "/helper" },
    { ...windowsRuntimeEnv, ZCODE_CUA_RUNTIME_PACKAGE_DIR: " " },
    { ...windowsRuntimeEnv, ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: " " },
  ])("requires explicit nonblank runtime and helper inputs: %j", (env) => {
    const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
    expect(
      isSharpRequiredByComputerUse({
        desktopPackageRoot,
        targetPlatform: { os: "win32", arch: "x64" },
        env,
      }),
    ).toBe(false);
  });

  it.each([
    null,
    { name: "@zcode/zcode-cua" },
    { zcodeCuaPlaceholder: true },
    { ...windowsSourceManifest, zcodeCuaRuntimeCapabilities: { windowsBroker: "true" } },
  ])("does not enable missing capability or legacy packages without Sharp: %j", (manifest) => {
    const desktopPackageRoot = createWorkspace(manifest, "root");
    expect(
      isSharpRequiredByComputerUse({
        desktopPackageRoot,
        targetPlatform: { os: "win32", arch: "x64" },
        env: windowsRuntimeEnv,
      }),
    ).toBe(false);
  });
});

describe("Windows source bridge Sharp assets", () => {
  it("development staging forwards its explicit environment to the helper dependency source", () => {
    const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
    const helperRoot = join(desktopPackageRoot, "supplied-helper");
    createSharpPackages(helperRoot, "x64");
    const pluginRoot = join(desktopPackageRoot, "plugin");
    mkdirSync(join(pluginRoot, ".zcode-plugin"), { recursive: true });
    writeFileSync(join(pluginRoot, ".zcode-plugin", "plugin.json"), "{}");
    const staged = stageDevCuaPluginRuntime({
      desktopPackageRoot,
      pluginRoot,
      platform: "win32",
      arch: "x64",
      env: {
        ...windowsRuntimeEnv,
        ZCODE_CUA_DEV_MODE: "1",
        ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: helperRoot,
      },
    });
    expect(staged.map((entry: { name: string }) => entry.name)).toEqual(
      resolveSharpRuntimePackageNames({ os: "win32", arch: "x64" }),
    );
    expect(existsSync(join(pluginRoot, "node_modules", "sharp", "lib", "index.js"))).toBe(true);
  });

  it.each(["ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR", "ZCODE_CUA_DEV_ROOT"])(
    "sources every Sharp package from explicit %s, not undeclared desktop dependencies",
    (helperKey) => {
      const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
      const helperRoot = join(desktopPackageRoot, "supplied-helper");
      createSharpPackages(helperRoot, "x64", "helper fixture must not execute");
      createSharpPackages(desktopPackageRoot, "x64", "desktop fixture must not execute");
      const glmDir = join(desktopPackageRoot, "plugin");
      const staged = stageSharpIntoBundledAgents({
        desktopPackageRoot,
        glmDir,
        targetPlatform: { os: "win32", arch: "x64" },
        env: { ZCODE_CUA_RUNTIME_PACKAGE_DIR: "/runtime", [helperKey]: helperRoot },
      });
      for (const entry of staged) {
        expect(entry.sourceRoot).toBe(join(helperRoot, "node_modules", entry.name));
      }
      expect(readFileSync(join(glmDir, "node_modules/sharp/lib/index.js"), "utf8")).toContain(
        "helper fixture",
      );
    },
  );

  it("preserves legacy desktop dependency resolution even with explicit helper inputs", () => {
    const desktopPackageRoot = createWorkspace(
      { name: "@zcode/zcode-cua", dependencies: { sharp: "^0.34.0" } },
      "root",
    );
    createSharpPackages(desktopPackageRoot, "x64");
    const staged = stageSharpIntoBundledAgents({
      desktopPackageRoot,
      glmDir: join(desktopPackageRoot, "plugin"),
      targetPlatform: { os: "win32", arch: "x64" },
      env: windowsRuntimeEnv,
    });
    for (const entry of staged) {
      expect(entry.sourceRoot).toBe(join(desktopPackageRoot, "node_modules", entry.name));
    }
  });

  it("rejects inconsistent helper package identities before staging", () => {
    const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
    const helperRoot = join(desktopPackageRoot, "supplied-helper");
    createSharpPackages(helperRoot, "x64");
    writeFileSync(
      join(helperRoot, "node_modules", "sharp", "package.json"),
      JSON.stringify({ name: "other-package" }),
    );
    const glmDir = join(desktopPackageRoot, "plugin");
    expect(() =>
      stageSharpIntoBundledAgents({
        desktopPackageRoot,
        glmDir,
        targetPlatform: { os: "win32", arch: "x64" },
        env: { ...windowsRuntimeEnv, ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: helperRoot },
      }),
    ).toThrow(/identity mismatch/);
    expect(existsSync(glmDir)).toBe(false);
  });

  it("requires a complete target package set from one helper and leaves previous output intact", () => {
    const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
    const helperRoot = join(desktopPackageRoot, "supplied-helper");
    createSharpPackages(helperRoot, "arm64");
    createSharpPackages(desktopPackageRoot, "x64");
    const glmDir = join(desktopPackageRoot, "plugin");
    mkdirSync(glmDir);
    writeFileSync(join(glmDir, "previous"), "keep");
    expect(() =>
      stageSharpIntoBundledAgents({
        desktopPackageRoot,
        glmDir,
        targetPlatform: { os: "win32", arch: "x64" },
        env: { ...windowsRuntimeEnv, ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: helperRoot },
      }),
    ).toThrow(/sharp-win32-x64/);
    expect(readFileSync(join(glmDir, "previous"), "utf8")).toBe("keep");
    expect(existsSync(join(glmDir, "node_modules"))).toBe(false);
  });

  it("prefers explicit runtime package over dev root and rejects relative helper paths", () => {
    const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
    const helperRoot = join(desktopPackageRoot, "supplied-helper");
    createSharpPackages(helperRoot, "x64");
    expect(() =>
      stageSharpIntoBundledAgents({
        desktopPackageRoot,
        glmDir: join(desktopPackageRoot, "plugin"),
        targetPlatform: { os: "win32", arch: "x64" },
        env: {
          ...windowsRuntimeEnv,
          ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: "relative-helper",
          ZCODE_CUA_DEV_ROOT: helperRoot,
        },
      }),
    ).toThrow(/absolute/);
  });

  it.skipIf(process.platform === "win32")(
    "rejects helper package links instead of reading another source",
    () => {
      const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
      const helperRoot = join(desktopPackageRoot, "supplied-helper");
      createSharpPackages(helperRoot, "x64");
      createSharpPackages(desktopPackageRoot, "x64");
      rmSync(join(helperRoot, "node_modules", "sharp"), { recursive: true });
      symlinkSync(
        join(desktopPackageRoot, "node_modules", "sharp"),
        join(helperRoot, "node_modules", "sharp"),
      );
      expect(() =>
        stageSharpIntoBundledAgents({
          desktopPackageRoot,
          glmDir: join(desktopPackageRoot, "plugin"),
          targetPlatform: { os: "win32", arch: "x64" },
          env: { ...windowsRuntimeEnv, ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR: helperRoot },
        }),
      ).toThrow(/contained physical package/);
    },
  );

  it.each(["x64", "arm64"])(
    "stages and verifies nested plugin-local %s files without executing them",
    (arch) => {
      const desktopPackageRoot = createWorkspace(windowsSourceManifest, "root");
      const targetPlatform = { os: "win32", arch };
      const resourcesDir = join(desktopPackageRoot, "resources");
      const pluginRelativePath = "packages/zcode-cua-plugin";
      const glmDir = join(resourcesDir, "glm", pluginRelativePath);
      const packageNames = resolveSharpRuntimePackageNames(targetPlatform);
      expect(packageNames).toEqual([
        "sharp",
        "detect-libc",
        "semver",
        "@img/colour",
        `@img/sharp-win32-${arch}`,
      ]);
      for (const name of packageNames) {
        const packageDir = join(desktopPackageRoot, "node_modules", name);
        mkdirSync(join(packageDir, "lib"), { recursive: true });
        writeFileSync(
          join(packageDir, "package.json"),
          JSON.stringify({ name, exports: { "./package": "./package.json" } }),
        );
        writeFileSync(
          join(packageDir, "lib", "index.js"),
          "throw new Error('fixture must not execute');",
        );
      }
      const nativeRelativeDir = join("node_modules", "@img", `sharp-win32-${arch}`, "lib");
      for (const name of ["sharp.node", "libvips-42.dll"]) {
        writeFileSync(
          join(desktopPackageRoot, nativeRelativeDir, name),
          "synthetic fixture, not a native binary",
        );
      }
      expect(
        isSharpRequiredByComputerUse({
          desktopPackageRoot,
          targetPlatform,
          env: windowsRuntimeEnv,
        }),
      ).toBe(true);
      const staged = stageSharpIntoBundledAgents({
        desktopPackageRoot,
        targetPlatform,
        glmDir,
        env: {},
      });
      expect(staged.map((entry: { name: string }) => entry.name)).toEqual(packageNames);
      expect(
        readFileSync(join(glmDir, "node_modules", "sharp", "lib", "index.js"), "utf8"),
      ).toContain("fixture must not execute");
      expect(verifyStagedSharp({ resourcesDir, targetPlatform, pluginRelativePath })).toEqual([]);
      expect(existsSync(join(dirname(glmDir), "browser-use-plugin"))).toBe(false);

      rmSync(join(glmDir, nativeRelativeDir, "libvips-42.dll"));
      expect(verifyStagedSharp({ resourcesDir, targetPlatform, pluginRelativePath })).toContain(
        `missing libvips DLL under @img/sharp-win32-${arch}/lib`,
      );
      rmSync(join(glmDir, nativeRelativeDir, "sharp.node"));
      expect(verifyStagedSharp({ resourcesDir, targetPlatform, pluginRelativePath })).toContain(
        `missing .node binary under @img/sharp-win32-${arch}/lib`,
      );

      stageSharpIntoBundledAgents({ desktopPackageRoot, targetPlatform, glmDir, env: {} });
      expect(verifyStagedSharp({ resourcesDir, targetPlatform, pluginRelativePath })).toEqual([]);
    },
  );
});
