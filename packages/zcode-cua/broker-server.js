import {
  externalWindowsCuaEnvironment,
  externalWindowsCuaFunction,
} from "./src/external-windows-runtime.js";
import { CuaHelperError } from "./broker.js";
import { HELPER_APP_NAME } from "./broker-helper-constants.js";

export const HELPER_ADDON_ENV = "ZCODE_CUA_HELPER_ADDON";
export const WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";

const UNAVAILABLE = "Computer Use is not available in this build.";

function unavailableReject() {
  return Promise.reject(new CuaHelperError(UNAVAILABLE));
}

export function buildHelperOpenArgs(_spec, _launcherPid) {
  return [];
}

export async function resolveHelperPermissionSubjectIdentity(_appPath) {
  const external = externalWindowsCuaFunction(
    "./broker/server",
    "resolveHelperPermissionSubjectIdentity",
  );
  if (external) return external(...arguments);
  throw new CuaHelperError(UNAVAILABLE);
}

export function isCuaLocalDevelopmentRuntime(_env, _compiledLocalDevelopmentRuntime) {
  return false;
}

export function createCuaHelperInstaller(_options) {
  const external = externalWindowsCuaFunction("./broker/server", "createCuaHelperInstaller");
  if (external) return external(...arguments);
  return {
    ensureInstalled: unavailableReject,
    verifyInstalled: unavailableReject,
  };
}

export const defaultCuaHelperVerifierDependencies = {
  readExecutableArchs: unavailableReject,
  verifyCodeSignature: unavailableReject,
  verifyTeamIdentifier: unavailableReject,
};

export function cuaBrokerRefreshMarkerPath(_socketPath) {
  const external = externalWindowsCuaFunction("./broker/server", "cuaBrokerRefreshMarkerPath");
  if (external) return external(...arguments);
  return undefined;
}

export async function publishCuaBrokerRefreshMarker(_socketPath, _options) {
  const external = externalWindowsCuaFunction("./broker/server", "publishCuaBrokerRefreshMarker");
  if (external) return external(...arguments);
  return { path: undefined };
}

export function loadRealNativeAddon(_options) {
  throw new CuaHelperError(UNAVAILABLE);
}

export function resolvePackagedNativeAddonPath(_options) {
  return undefined;
}

export function resolveInTreeAddonPath(_options) {
  return undefined;
}

export function createAxReadOnlyMethods(_source, _registry, _options) {
  return {};
}

export const ROLE_TO_KIND = {};

export function roleToKind(_role) {
  return undefined;
}

export class CuaHelperLifecycleManager {
  #dispose;
  #current;
  #disposed = false;
  constructor(dispose) {
    const External = externalWindowsCuaFunction("./broker/server", "CuaHelperLifecycleManager");
    if (External) return new External(dispose);
    this.#dispose = dispose;
    this.#current = undefined;
  }
  async acquire(options) {
    if (typeof options?.isAdmitted === "function" && !options.isAdmitted()) {
      return undefined;
    }
    const managed = options?.create?.();
    this.#current = managed;
    return managed;
  }
  peek() {
    return this.#current;
  }
  get disposed() {
    return this.#disposed;
  }
  async dispose(managed) {
    this.#disposed = true;
    await this.#dispose?.(managed ?? this.#current);
  }
}

export class CuaProductHelperWorkspaceRegistry {
  constructor() {
    const External = externalWindowsCuaFunction(
      "./broker/server",
      "CuaProductHelperWorkspaceRegistry",
    );
    if (External) return new External();
  }
  setEnabled(_context, _enabled) {}
}

export function createProductCuaHelperHost(_options) {
  const external = externalWindowsCuaFunction("./broker/server", "createProductCuaHelperHost");
  if (external) return external(...arguments);
  return createUnavailableCuaHelperHost();
}

function createUnavailableCuaHelperHost() {
  return {
    get running() {
      return false;
    },
    get socketPath() {
      return null;
    },
    get pluginAuthority() {
      return null;
    },
    get reservedTransport() {
      return undefined;
    },
    start: unavailableReject,
    stop: async () => {},
    restart: unavailableReject,
    restartAfterCurrentStart: unavailableReject,
    waitForTransport: unavailableReject,
    checkHealth: unavailableReject,
    queryScreenCaptureProbe: async () => ({
      ok: false,
      reason: UNAVAILABLE,
    }),
    queryScreenRecordingPreflight: async () => undefined,
    queryPermissionStatus: async () => ({}),
  };
}

export function isOfficialCuaPluginEnabledForWorkspace(_options) {
  const external = externalWindowsCuaFunction(
    "./broker/server",
    "isOfficialCuaPluginEnabledForWorkspace",
  );
  if (external) return external(...arguments);
  return false;
}

export function createCuaProductMcpServerResolver(_host, _options) {
  const external = externalWindowsCuaFunction(
    "./broker/server",
    "createCuaProductMcpServerResolver",
  );
  if (external) return external(...arguments);
  return {
    async resolveMcpServers(servers, _context) {
      return servers;
    },
    async restart() {
      throw new Error(UNAVAILABLE);
    },
    async restartAfterPermissionGrant(_onboardingSessionId) {
      throw new Error(UNAVAILABLE);
    },
  };
}

export async function waitForCuaHelperStartup(startup, _deadlineMs) {
  const external = externalWindowsCuaFunction("./broker/server", "waitForCuaHelperStartup");
  if (external) return external(...arguments);
  return await startup;
}

export function isPotentialZCodeCuaAgentMcpServer(server) {
  // 这是移除未代理 CUA 条目的纯识别边界，不是权限判定；不能依赖外部 runtime 成功加载。
  if (!server || typeof server !== "object" || typeof server.command !== "string") return false;
  const name = typeof server.name === "string" ? server.name.trim().toLowerCase() : "";
  const env = Array.isArray(server.env) ? server.env : [];
  const value = (key) =>
    env.find((item) => item?.name === key && typeof item.value === "string")?.value;
  const isPackage = (text) => {
    if (typeof text !== "string") return false;
    const leaf = text
      .replace(/[\\/]+$/u, "")
      .split(/[\\/]/u)
      .at(-1);
    return [text, leaf].some((part) =>
      /^zcode-cua(?:$|\[|@|==|\.)/u.test(part?.replace(/_/gu, "-")),
    );
  };
  if (name === "computer-use") return true;
  if (name.startsWith("plugin:")) {
    if (
      name === "plugin:computer-use:computer-use" &&
      value("ZCODE_PLUGIN_ID")?.trim().toLowerCase() === "computer-use@zcode-plugins-official"
    )
      return true;
    if (isPackage(value("ZCODE_CUA_PACKAGE_SPEC"))) return true;
  }
  return isPackage(server.command) || (Array.isArray(server.args) && server.args.some(isPackage));
}

export function isScreenCaptureProbeSuccess(_probe) {
  const external = externalWindowsCuaFunction("./broker/server", "isScreenCaptureProbeSuccess");
  if (external) return external(...arguments);
  return false;
}

export function markCuaProductHelperAgentEnvUnavailable(_host) {
  const external = externalWindowsCuaFunction(
    "./broker/server",
    "markCuaProductHelperAgentEnvUnavailable",
  );
  if (external) return external(...arguments);
}

export function hasCuaProductHelperAgentEnvUnavailable(_host) {
  const external = externalWindowsCuaFunction(
    "./broker/server",
    "hasCuaProductHelperAgentEnvUnavailable",
  );
  if (external) return external(...arguments);
  return false;
}

export function clearCuaProductHelperAgentEnvUnavailable(_host) {
  const external = externalWindowsCuaFunction(
    "./broker/server",
    "clearCuaProductHelperAgentEnvUnavailable",
  );
  if (external) return external(...arguments);
}

export async function reapOrphanedHelpers(_options) {}

export async function requestHelperAccessibilityPermissionViaLaunchServices(_options) {
  return { ok: false, reason: UNAVAILABLE };
}

export async function requestHelperScreenRecordingPermissionViaLaunchServices(_options) {
  return { ok: false, reason: UNAVAILABLE };
}

// 开源构建不携带 Computer Use Helper：没有安装根目录，也没有独立 Helper 候选路径。
export function resolveHelperAppName(_env) {
  return HELPER_APP_NAME;
}

export function resolveCuaHelperInstallRoot(_env) {
  return null;
}

export function standaloneHelperCandidatePaths(_env) {
  return [];
}

// 开源构建不注入 Computer Use broker MCP 服务，原样返回。
export function injectPermissionBrokerAgentMcpServers(servers, _options) {
  return servers;
}

export function resolveWindowsCuaRuntimeEnvironment(options) {
  return externalWindowsCuaEnvironment(options);
}
