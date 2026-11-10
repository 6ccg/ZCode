import { lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";

export const WINDOWS_CUA_RUNTIME_ROOT_ENV = "ZCODE_CUA_RUNTIME_PACKAGE_DIR";
const manifests = new Map();
const modules = new Map();

export class ExternalWindowsCuaRuntimeError extends Error {
  constructor(message, cause) {
    super(`Windows Computer Use runtime: ${message}`, { cause });
    this.name = "ExternalWindowsCuaRuntimeError";
    this.code = "external_runtime_unavailable";
  }
}

function contained(root, path) {
  const value = relative(root, path);
  return value && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function regularContainedFile(root, path) {
  if (!contained(root, path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new ExternalWindowsCuaRuntimeError("public module must be a contained regular file");
  }
  const physicalPath = realpathSync(path);
  if (!contained(root, physicalPath)) {
    throw new ExternalWindowsCuaRuntimeError("public module escapes its runtime root");
  }
  return physicalPath;
}

export function resolveExternalWindowsCuaRuntime(options = {}) {
  if ((options.platform ?? process.platform) !== "win32") return undefined;
  const env = options.env ?? process.env;
  const explicit = env[WINDOWS_CUA_RUNTIME_ROOT_ENV]?.trim();
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const configured =
    explicit || (resourcesPath ? join(resourcesPath, "tools", "zcode-cua") : undefined);
  if (!configured) return undefined;
  if (!isAbsolute(configured)) {
    throw new ExternalWindowsCuaRuntimeError(`${WINDOWS_CUA_RUNTIME_ROOT_ENV} must be absolute`);
  }
  try {
    if (!lstatSync(configured).isDirectory() || lstatSync(configured).isSymbolicLink()) {
      throw new ExternalWindowsCuaRuntimeError("runtime root must be a regular directory");
    }
    const root = realpathSync(configured);
    const cached = manifests.get(root);
    if (cached) return cached;
    const packagePath = regularContainedFile(root, join(root, "package.json"));
    // 现有 factory/class 是同步公共契约；只在首次模块装载时读取小清单，后续复用 Node 缓存。
    const require = createRequire(packagePath);
    const manifest = require(packagePath);
    if (
      manifest?.name !== "@zcode/zcode-cua" ||
      manifest.type !== "module" ||
      typeof manifest.version !== "string" ||
      !manifest.version.trim() ||
      manifest.zcodeCuaPlaceholder === true ||
      !manifest.exports ||
      typeof manifest.exports !== "object" ||
      Array.isArray(manifest.exports) ||
      Object.keys(manifest.dependencies ?? {}).length ||
      Object.keys(manifest.optionalDependencies ?? {}).length
    ) {
      throw new ExternalWindowsCuaRuntimeError(
        "expected a dependency-free, non-placeholder @zcode/zcode-cua module bundle",
      );
    }
    const result = { root, manifest, require };
    manifests.set(root, result);
    return result;
  } catch (error) {
    if (!explicit && error?.code === "ENOENT") return undefined;
    if (error instanceof ExternalWindowsCuaRuntimeError) throw error;
    throw new ExternalWindowsCuaRuntimeError("configured bundle cannot be loaded", error);
  }
}

export function loadExternalWindowsCuaModule(entry, options = {}) {
  const runtime = resolveExternalWindowsCuaRuntime(options);
  if (!runtime) return undefined;
  const key = `${runtime.root}\0${entry}`;
  if (modules.has(key)) return modules.get(key);
  const descriptor = runtime.manifest.exports[entry];
  const target = typeof descriptor === "string" ? descriptor : descriptor?.import;
  if (
    typeof target !== "string" ||
    !target.startsWith("./") ||
    target.includes("\\") ||
    target.includes(":") ||
    target.includes("\0") ||
    target
      .slice(2)
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    win32.isAbsolute(target) ||
    !/\.(?:js|mjs|cjs)$/u.test(target)
  ) {
    throw new ExternalWindowsCuaRuntimeError(`invalid public export ${entry}`);
  }
  try {
    const modulePath = regularContainedFile(runtime.root, resolve(runtime.root, target));
    const module = runtime.require(modulePath);
    modules.set(key, module);
    return module;
  } catch (error) {
    if (error instanceof ExternalWindowsCuaRuntimeError) throw error;
    throw new ExternalWindowsCuaRuntimeError(`failed to load public export ${entry}`, error);
  }
}

export function externalWindowsCuaFunction(entry, name, options) {
  const module = loadExternalWindowsCuaModule(entry, options);
  if (!module) return undefined;
  if (typeof module[name] !== "function") {
    throw new ExternalWindowsCuaRuntimeError(`public export ${entry} does not implement ${name}`);
  }
  return module[name];
}

export function externalWindowsCuaEnvironment(options) {
  const runtime = resolveExternalWindowsCuaRuntime(options);
  return runtime ? { [WINDOWS_CUA_RUNTIME_ROOT_ENV]: runtime.root } : {};
}
