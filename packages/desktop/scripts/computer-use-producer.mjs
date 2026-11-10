import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isBuiltin } from "node:module";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, isAbsolute, relative, sep, posix } from "node:path";

/**
 * 判定当前安装的 `@zcode/zcode-cua` 是闭源真实 producer 还是开源占位包。
 *
 * 闭源构建使用 workspace 内 `packages/zcode-cua` 的真实 producer；开源导出把该目录整体换成占位包，
 * 占位包在 package.json 声明 `zcodeCuaPlaceholder: true`，所有能力 fail-closed。
 * 开发、构建与打包里只服务于真实 Computer Use 的步骤（构建 Helper、暂存插件原生依赖、
 * Windows Helper 资源、打包后的 Helper 校验）都以本判定为门，检测不到真实 producer 时跳过，
 * Windows source broker 的显式 Helper 输入另由 isWindowsComputerUseHelperEnabled 判定。
 * 不能因为缺少私有产物让开源树的入口失败。规范见 docs/desktop/computer-use-producer-detection.md。
 *
 * 构建配置（electron-builder、tsup）同步求值，这里只做一次小文件同步读取。
 */
export function readComputerUseProducer({ desktopPackageRoot }) {
  // 从桌面包向上查找最近的安装：闭源 hoisted 布局在仓库根，开源占位包链接在桌面包下。
  for (let dir = resolve(desktopPackageRoot); ; dir = dirname(dir)) {
    const manifestPath = resolve(dir, "node_modules", "@zcode", "zcode-cua", "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      return {
        installed: true,
        placeholder: manifest.zcodeCuaPlaceholder === true,
        manifest,
        packageRoot: dirname(manifestPath),
      };
    }
    if (dirname(dir) === dir) return { installed: false, placeholder: false };
  }
}

export function isRealComputerUseProducerInstalled({ desktopPackageRoot }) {
  const producer = readComputerUseProducer({ desktopPackageRoot });
  return producer.installed && !producer.placeholder;
}

/** Build-only input; the released app discovers resources/tools locally. */
export function configureBundledComputerUse({ desktopPackageRoot, target, env = process.env }) {
  const input = env.ZCODE_CUA_BUNDLE_DIR?.trim();
  if (!input) return undefined;
  if (!["win32", "darwin"].includes(target.os))
    throw new Error("Bundled CUA supports Windows and macOS only");
  if (!isAbsolute(input)) throw new Error("ZCODE_CUA_BUNDLE_DIR must be absolute");
  const bundle = JSON.parse(readFileSync(resolve(input, "bundle-manifest.json"), "utf8"));
  const targetKey = target.key ?? `${target.os}-${target.arch}`;
  if (target.os === "darwin" && bundle.macosHelperSigned !== true)
    throw new Error("Mac CUA helper must be signed on macOS before packaging");
  const app = JSON.parse(readFileSync(resolve(desktopPackageRoot, "package.json"), "utf8"));
  const workspace = JSON.parse(
    readFileSync(resolve(desktopPackageRoot, "../..", "package.json"), "utf8"),
  );
  if (
    bundle.schemaVersion !== 1 ||
    bundle.target !== targetKey ||
    bundle.applicationVersion !== workspace.version ||
    bundle.electronVersion !== app.devDependencies.electron ||
    bundle.independentUpdates !== false
  ) {
    throw new Error("Bundled CUA must match this application's version, Electron and target");
  }
  const runtimeRoot = resolve(input, "runtime");
  const hash = createHash("sha256")
    .update(readFileSync(resolve(runtimeRoot, "vendor/dist-index.js")))
    .digest("hex");
  if (hash !== bundle.patchedRuntimeSha256) throw new Error("Bundled CUA runtime hash mismatch");
  env.ZCODE_CUA_RUNTIME_PACKAGE_DIR = runtimeRoot;
  if (target.os === "win32") env.ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR = resolve(input, "helper");
  if (target.os === "darwin")
    env.ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR = resolve(
      input,
      "helper/ZCode Computer Use.app/Contents/Resources",
    );
  return { root: input, manifest: bundle, runtimeRoot };
}

export function isBundledMacComputerUseEnabled({
  desktopPackageRoot,
  platform,
  env = process.env,
}) {
  if (platform !== "darwin") return false;
  const producer = readComputerUseProducer({ desktopPackageRoot });
  return (
    producer.manifest?.zcodeCuaRuntimeCapabilities?.macosBroker === true &&
    Boolean(env.ZCODE_CUA_RUNTIME_PACKAGE_DIR?.trim()) &&
    Boolean(env.ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR?.trim())
  );
}

/** Windows broker capability is not proof of a usable or validated native helper. */
export function isWindowsComputerUseHelperEnabled({
  desktopPackageRoot,
  platform,
  env = process.env,
}) {
  if (platform !== "win32") return false;
  const producer = readComputerUseProducer({ desktopPackageRoot });
  if (!producer.installed) return false;
  if (!producer.placeholder) return true;
  // 开源 Windows broker 不等于完整 producer；仅显式 Helper 输入才进入现有严格校验链。
  return (
    producer.manifest.zcodeCuaRuntimeCapabilities?.windowsBroker === true &&
    typeof env.ZCODE_CUA_RUNTIME_PACKAGE_DIR === "string" &&
    env.ZCODE_CUA_RUNTIME_PACKAGE_DIR.trim().length > 0 &&
    [env.ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR, env.ZCODE_CUA_DEV_ROOT].some(
      (value) => typeof value === "string" && value.trim().length > 0,
    )
  );
}

const WINDOWS_RUNTIME_EXPORTS = [
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
];

/** Read a bounded, contained JS-only tree without evaluating external code. */
async function readWindowsRuntimeFiles(sourceRoot) {
  if (!isAbsolute(sourceRoot)) throw new Error("Windows CUA runtime root must be absolute");
  const rootStats = await lstat(sourceRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Windows CUA runtime root must be a physical directory");
  }
  const physicalRoot = await realpath(sourceRoot);
  const files = new Map();
  let totalBytes = 0;
  let entryCount = 0;
  async function walk(directory, depth = 0) {
    if (depth > 32) throw new Error("Windows CUA runtime tree is too deep");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entryCount > 4096) throw new Error("Windows CUA runtime exceeds staging limits");
      const path = resolve(directory, entry.name);
      const stats = await lstat(path);
      const physical = await realpath(path);
      if (stats.isSymbolicLink() || !physical.startsWith(`${physicalRoot}${sep}`)) {
        throw new Error(`Windows CUA runtime path must not escape or be a symlink: ${path}`);
      }
      if (stats.isDirectory()) {
        if (entry.name === "node_modules")
          throw new Error("Windows CUA runtime must not contain node_modules");
        await walk(path, depth + 1);
        continue;
      }
      if (!stats.isFile()) throw new Error(`Windows CUA runtime entry is not a file: ${path}`);
      if (/\.(?:node|dll|exe|so|dylib)$/i.test(entry.name)) {
        throw new Error(`Native file is not permitted in Windows CUA JS runtime: ${path}`);
      }
      totalBytes += stats.size;
      if (totalBytes > 32 * 1024 * 1024 || files.size >= 4096) {
        throw new Error("Windows CUA runtime exceeds staging limits");
      }
      const bytes = await readFile(path);
      if (
        bytes.subarray(0, 2).toString() === "MZ" ||
        bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))
      ) {
        throw new Error(`Native content is not permitted in Windows CUA JS runtime: ${path}`);
      }
      if (
        !/\.(?:js|cjs|mjs|json)$/i.test(entry.name) &&
        !/^(?:licen[sc]e|notice)(?:\..*)?$/i.test(entry.name)
      )
        continue;
      files.set(relative(physicalRoot, physical).split(sep).join("/"), bytes);
    }
  }
  await walk(physicalRoot);
  const manifest = JSON.parse(files.get("package.json")?.toString() ?? "null");
  if (
    manifest?.name !== "@zcode/zcode-cua" ||
    manifest.type !== "module" ||
    manifest.zcodeCuaPlaceholder === true
  ) {
    throw new Error(
      "Windows CUA runtime must be a non-placeholder @zcode/zcode-cua ES module package",
    );
  }
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("Windows CUA runtime must declare a nonblank version");
  }
  if (
    Object.keys(manifest.dependencies ?? {}).length ||
    Object.keys(manifest.optionalDependencies ?? {}).length
  ) {
    throw new Error("Windows CUA runtime must have no declared npm dependencies");
  }
  for (const name of WINDOWS_RUNTIME_EXPORTS) {
    const entry = manifest.exports?.[name];
    const target = typeof entry === "string" ? entry : entry?.import;
    if (
      typeof target !== "string" ||
      !/^\.\/[\w./-]+\.(?:js|mjs|cjs)$/.test(target) ||
      target
        .slice(2)
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      !files.has(target.slice(2))
    ) {
      throw new Error(`Windows CUA runtime is missing a contained JS export: ${name}`);
    }
  }
  await validateWindowsRuntimeImports(files);
  return files;
}

export async function verifyWindowsComputerUseRuntime({ sourceRoot }) {
  await readWindowsRuntimeFiles(sourceRoot);
}

export async function stageWindowsComputerUseRuntime({ sourceRoot, outputDir }) {
  // 先完整验证并快照输入，再写暂存目录；失败不能留下看似可用的半份 vendor runtime。
  const files = await readWindowsRuntimeFiles(sourceRoot);
  if (
    !isAbsolute(outputDir) ||
    resolve(outputDir) === resolve(sourceRoot) ||
    resolve(outputDir).startsWith(`${resolve(sourceRoot)}${sep}`) ||
    resolve(sourceRoot).startsWith(`${resolve(outputDir)}${sep}`)
  ) {
    throw new Error("Windows CUA runtime output must be separate from its input");
  }
  await mkdir(dirname(outputDir), { recursive: true });
  const staging = await mkdtemp(`${outputDir}.staging-`);
  try {
    for (const [path, bytes] of files) {
      const destination = resolve(staging, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    await rm(outputDir, { recursive: true, force: true });
    await rename(staging, outputDir);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { outputDir, fileCount: files.size };
}

async function validateWindowsRuntimeImports(files) {
  // TypeScript 是已声明的构建依赖；只解析 AST，不能 import/执行外部 vendor。
  const ts = await import("typescript");
  for (const [path, bytes] of files) {
    if (!/\.(?:js|mjs|cjs)$/.test(path)) continue;
    const source = ts.createSourceFile(
      path,
      bytes.toString(),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    if (source.parseDiagnostics.length)
      throw new Error(`Invalid Windows CUA runtime JavaScript: ${path}`);
    const loaders = new Set(["require"]);
    const factories = new Set(["createRequire"]);
    function collect(node) {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === "node:module") {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            if ((binding.propertyName ?? binding.name).text === "createRequire")
              factories.add(binding.name.text);
          }
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = node.initializer;
        if (
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          factories.has(init.expression.text)
        )
          loaders.add(node.name.text);
        if (ts.isIdentifier(init)) {
          if (loaders.has(init.text)) loaders.add(node.name.text);
          if (factories.has(init.text)) factories.add(node.name.text);
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(source);
    function checkSpecifier(specifier, commonJs = false) {
      if (isBuiltin(specifier)) return;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        throw new Error(`Unresolved Windows CUA runtime dependency in ${path}: ${specifier}`);
      }
      const target = posix.normalize(posix.join(posix.dirname(path), specifier));
      if (
        target === ".." ||
        target.startsWith("../") ||
        specifier.includes("\\") ||
        specifier.includes("%")
      ) {
        throw new Error(`Windows CUA runtime import escapes its tree in ${path}: ${specifier}`);
      }
      const candidates = commonJs
        ? [
            target,
            `${target}.js`,
            `${target}.cjs`,
            `${target}.json`,
            `${target}/index.js`,
            `${target}/index.json`,
          ]
        : [target];
      if (!candidates.some((candidate) => files.has(candidate))) {
        throw new Error(`Missing Windows CUA runtime import in ${path}: ${specifier}`);
      }
    }
    function insideOptionalBranch(node) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          ts.isTryStatement(parent) ||
          ts.isIfStatement(parent) ||
          ts.isConditionalExpression(parent)
        )
          return true;
      }
      return false;
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        checkSpecifier(node.moduleSpecifier.text);
      if (ts.isCallExpression(node)) {
        const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const requireCall = ts.isIdentifier(node.expression) && loaders.has(node.expression.text);
        if (dynamicImport || requireCall) {
          const argument = node.arguments[0];
          const literal =
            argument &&
            (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument));
          if (dynamicImport && !literal)
            throw new Error(`Computed Windows CUA runtime import is unsupported: ${path}`);
          if (
            requireCall &&
            !literal &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "require"
          ) {
            throw new Error(`Computed Windows CUA runtime require is unsupported: ${path}`);
          }
          // 可选分支和 createRequire 的动态宿主依赖不能静态证明；不把它们当成完整依赖闭包。
          if (literal && (dynamicImport || !insideOptionalBranch(node)))
            checkSpecifier(argument.text, requireCall);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
