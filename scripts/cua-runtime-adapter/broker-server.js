// MIT bridge adapted from luxi233/ZcodePro; maintained for this project's current Windows CUA contracts.
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { CuaHelperError, BrokerError } from "./broker.js";
var REFRESH_MARKER_SUFFIX = ".permission-refresh.json",
  REFRESH_MARKER_DEFAULT_DEADLINE_MS = 3e4,
  REFRESH_MARKER_MAX_DEADLINE_MS = 12e4,
  refreshMarkerInFlight = /* @__PURE__ */ new Map();
function cuaBrokerRefreshMarkerPath(socketPath) {
  let trimmed = socketPath?.trim();
  if (!trimmed)
    throw new CuaHelperError(
      "invalid_argument",
      "CUA broker refresh marker requires a non-empty socket path",
    );
  return `${trimmed}${REFRESH_MARKER_SUFFIX}`;
}
async function publishCuaBrokerRefreshMarker(socketPath, options = {}) {
  let now = options.now ?? Date.now,
    deadlineMs = options.deadlineMs ?? REFRESH_MARKER_DEFAULT_DEADLINE_MS;
  if (
    !Number.isFinite(deadlineMs) ||
    deadlineMs <= 0 ||
    deadlineMs > REFRESH_MARKER_MAX_DEADLINE_MS
  )
    throw new CuaHelperError(
      "invalid_argument",
      `CUA broker refresh marker deadline must be within 1-${REFRESH_MARKER_MAX_DEADLINE_MS}ms, got ${deadlineMs}`,
    );
  let path = cuaBrokerRefreshMarkerPath(socketPath);
  if (refreshMarkerInFlight.has(path))
    throw new CuaHelperError(
      "controller_busy",
      "CUA broker permission refresh is already active for this transport",
    );
  let id = Symbol("cua-broker-refresh-marker");
  refreshMarkerInFlight.set(path, { id });
  let started = now(),
    deadlineEpochMs = started + deadlineMs;
  if (
    !Number.isSafeInteger(started) ||
    !Number.isSafeInteger(deadlineEpochMs) ||
    deadlineEpochMs <= started
  )
    throw (
      refreshMarkerInFlight.delete(path),
      new CuaHelperError("internal", "CUA broker refresh marker clock produced an invalid deadline")
    );
  let body = `${JSON.stringify({ schema: 1, kind: "permission_refresh", deadlineEpochMs })}
`,
    tmp = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    (await writeFile(tmp, body, { encoding: "utf8", flag: "wx", mode: 384 }),
      await chmod(tmp, 384),
      await rename(tmp, path));
  } catch (error) {
    throw (
      await rm(tmp, { force: true }).catch(() => {}),
      refreshMarkerInFlight.get(path)?.id === id && refreshMarkerInFlight.delete(path),
      error
    );
  }
  return {
    path,
    deadlineEpochMs,
    complete: async () => {
      if (refreshMarkerInFlight.get(path)?.id !== id) return;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1)
        try {
          (await rm(path, { force: true }), (lastError = void 0));
          break;
        } catch (error) {
          ((lastError = error),
            attempt < 2 && (await new Promise((resolve) => setTimeout(resolve, 10))));
        }
      if (lastError) throw lastError;
      refreshMarkerInFlight.get(path)?.id === id && refreshMarkerInFlight.delete(path);
    },
  };
}
var recoveryStateByHost = /* @__PURE__ */ new WeakMap();
function recoveryStateFor(host) {
  let state = recoveryStateByHost.get(host);
  return (
    state ||
      ((state = { generation: 0, pendingGeneration: null }), recoveryStateByHost.set(host, state)),
    state
  );
}
function markCuaProductHelperAgentEnvUnavailable(host) {
  let state = recoveryStateFor(host);
  return ((state.generation += 1), (state.pendingGeneration = state.generation), state.generation);
}
function pendingCuaProductHelperRecoveryGeneration(host) {
  return recoveryStateByHost.get(host)?.pendingGeneration ?? null;
}
function commitCuaProductHelperRecoveryGeneration(host, generation) {
  let state = recoveryStateByHost.get(host);
  return !state || state.pendingGeneration !== generation
    ? false
    : ((state.pendingGeneration = null), true);
}
function hasCuaProductHelperAgentEnvUnavailable(host) {
  return pendingCuaProductHelperRecoveryGeneration(host) !== null;
}
function clearCuaProductHelperAgentEnvUnavailable(host) {
  let state = recoveryStateByHost.get(host);
  state && (state.pendingGeneration = null);
}
var DEFAULT_STARTUP_DEADLINE_MS = 1e4;
async function waitForCuaHelperStartup(startup, deadlineMs = DEFAULT_STARTUP_DEADLINE_MS) {
  let timer;
  try {
    return await Promise.race([
      startup,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new BrokerError(
              "caller_timeout",
              `ZCode Computer Use is still starting after ${deadlineMs}ms; retry the task shortly`,
            ),
          );
        }, deadlineMs);
      }),
    ]);
  } finally {
    timer && clearTimeout(timer);
  }
}
var PLUGIN_ID_ENV = "ZCODE_PLUGIN_ID",
  OFFICIAL_CUA_PLUGIN_ID = "computer-use@zcode-plugins-official",
  PLUGIN_AUTHORITY_ENV = "ZCODE_CUA_PLUGIN_AUTHORITY",
  CUA_MCP_SERVER_NAME = "computer-use",
  CUA_MCP_NAMESPACED_NAME = "plugin:computer-use:computer-use",
  CUA_PACKAGE_SPEC_ENV = "ZCODE_CUA_PACKAGE_SPEC",
  BROKER_SOCKET_ARG = "--permission-broker-socket",
  REFRESH_MARKER_ENV = "ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER",
  BROKER_SOCKET_ENV_NAME = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
function zcodeCuaArgLeaf(value) {
  return (
    value
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? value
  );
}
function matchesZCodeCuaSpec(value) {
  let normalized = value.replace(/_/g, "-");
  return (
    normalized === "zcode-cua" ||
    normalized.startsWith("zcode-cua[") ||
    normalized.startsWith("zcode-cua@") ||
    normalized.startsWith("zcode-cua==") ||
    normalized.startsWith("zcode-cua.")
  );
}
function hasZCodeCuaPackageBoundary(value) {
  return matchesZCodeCuaSpec(value);
}
function matchesZCodeCuaSpecBroad(value) {
  let lowered = value.toLowerCase().replace(/_/g, "-");
  if (hasZCodeCuaPackageBoundary(lowered)) return true;
  let dotNormalized = lowered.replace(/([a-z0-9])\.(?=[a-z0-9])/g, "$1-");
  return hasZCodeCuaPackageBoundary(dotNormalized);
}
function isZCodeCuaMcpServerName(name, pluginId) {
  let normalized = name.trim().toLowerCase();
  return normalized === CUA_MCP_SERVER_NAME
    ? true
    : normalized === CUA_MCP_NAMESPACED_NAME &&
        pluginId?.trim().toLowerCase() === OFFICIAL_CUA_PLUGIN_ID;
}
function isZCodeCuaMcpCommand(command) {
  return matchesZCodeCuaSpec(command) || matchesZCodeCuaSpec(zcodeCuaArgLeaf(command));
}
function isZCodeCuaMcpPackageArg(arg) {
  return matchesZCodeCuaSpec(arg) || matchesZCodeCuaSpec(zcodeCuaArgLeaf(arg));
}
function resolvesToZCodeCuaPackage({ command, args, packageSpec }) {
  let candidates = [],
    push = (value) => {
      if (!value) return;
      candidates.push(value);
      let leaf = zcodeCuaArgLeaf(value);
      leaf !== value && candidates.push(leaf);
    };
  if ((push(command), args)) for (let arg of args) push(arg);
  return (push(packageSpec), candidates.some(matchesZCodeCuaSpecBroad));
}
function asCommandServer(server) {
  return typeof server == "object" &&
    server !== null &&
    "command" in server &&
    typeof server.command == "string"
    ? server
    : null;
}
function normalizeAgentMcpArgs(args) {
  return Array.isArray(args) ? args.filter((arg) => typeof arg == "string") : [];
}
function normalizeAgentMcpEnv(env) {
  return Array.isArray(env)
    ? env.filter(
        (entry) =>
          typeof entry == "object" &&
          entry !== null &&
          typeof entry.name == "string" &&
          typeof entry.value == "string",
      )
    : [];
}
function upsertEnv(env, name, value) {
  let filtered = env.filter((entry) => entry.name !== name).map((entry) => ({ ...entry }));
  return (filtered.push({ name, value }), filtered);
}
function isPotentialZCodeCuaAgentMcpServer(server) {
  let command = asCommandServer(server);
  if (!command) return false;
  let name = "name" in server && typeof server.name == "string" ? server.name : "";
  if (name.trim().toLowerCase().startsWith("plugin:")) {
    let envEntries = normalizeAgentMcpEnv(command.env),
      pluginId = envEntries.find((entry) => entry.name === PLUGIN_ID_ENV)?.value;
    if (isZCodeCuaMcpServerName(name, pluginId)) return true;
    let packageSpec = envEntries.find((entry) => entry.name === CUA_PACKAGE_SPEC_ENV)?.value;
    if (packageSpec && isZCodeCuaMcpPackageArg(packageSpec)) return true;
  } else if (name && isZCodeCuaMcpServerName(name, void 0)) return true;
  return isZCodeCuaMcpCommand(command.command)
    ? true
    : normalizeAgentMcpArgs(command.args).some(isZCodeCuaMcpPackageArg);
}
function isOfficialZCodeCuaPluginCandidate(server) {
  let command = asCommandServer(server);
  return !command ||
    ("name" in server && typeof server.name == "string" ? server.name : "").trim().toLowerCase() !==
      CUA_MCP_NAMESPACED_NAME
    ? false
    : normalizeAgentMcpEnv(command.env)
        .find((entry) => entry.name === PLUGIN_ID_ENV)
        ?.value.trim()
        .toLowerCase() === OFFICIAL_CUA_PLUGIN_ID;
}
function isAuthorizedOfficialZCodeCuaPluginServer(server, pluginAuthority) {
  let authority = pluginAuthority?.trim();
  return !authority || !isOfficialZCodeCuaPluginCandidate(server)
    ? false
    : normalizeAgentMcpEnv(server.env).some(
        (entry) => entry.name === PLUGIN_AUTHORITY_ENV && entry.value === authority,
      );
}
function isUnbrokeredZCodeCuaAgentMcpServer(server) {
  let command = asCommandServer(server);
  if (!command) return false;
  let envEntries = normalizeAgentMcpEnv(command.env),
    packageSpec = envEntries.find((entry) => entry.name === CUA_PACKAGE_SPEC_ENV)?.value;
  return resolvesToZCodeCuaPackage({
    command: command.command,
    args: normalizeAgentMcpArgs(command.args),
    packageSpec,
  })
    ? !envEntries.find((entry) => entry.name === BROKER_SOCKET_ENV_NAME)?.value?.trim()
    : false;
}
function optionArgsBeforeTerminator(args) {
  let index = args.indexOf("--");
  return index === -1 ? args : args.slice(0, index);
}
function hasSeparateOptionValue(value) {
  return value !== void 0 && value !== "--" && !value.startsWith("--");
}
function upsertFlag(args, flag, value) {
  let terminatorIndex = args.indexOf("--"),
    before = optionArgsBeforeTerminator(args),
    after = terminatorIndex === -1 ? [] : args.slice(terminatorIndex),
    kept = [];
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === flag) {
      hasSeparateOptionValue(before[i + 1]) && (i += 1);
      continue;
    }
    before[i]?.startsWith(`${flag}=`) || kept.push(before[i]);
  }
  args.splice(0, args.length, ...kept, flag, value, ...after);
}
function injectPermissionBrokerAgentMcpServer(server, transport) {
  if (!isAuthorizedOfficialZCodeCuaPluginServer(server, transport.pluginAuthority)) return server;
  if (!transport.socketPath || transport.socketPath.trim().length === 0)
    throw new CuaHelperError(
      "invalid_argument",
      "injectPermissionBrokerAgentMcpServers requires a non-empty socketPath",
    );
  let args = normalizeAgentMcpArgs(server.args);
  upsertFlag(args, BROKER_SOCKET_ARG, transport.socketPath);
  let markerPath = cuaBrokerRefreshMarkerPath(transport.socketPath),
    env = upsertEnv(normalizeAgentMcpEnv(server.env), BROKER_SOCKET_ENV_NAME, transport.socketPath);
  return ((env = upsertEnv(env, REFRESH_MARKER_ENV, markerPath)), { ...server, args, env });
}
function injectPermissionBrokerAgentMcpServers(servers, transport) {
  if (!servers || servers.length === 0 || !transport.pluginAuthority?.trim()) return servers;
  let injected = servers.map((server) => injectPermissionBrokerAgentMcpServer(server, transport));
  return injected.some((server, index) => server !== servers[index]) ? injected : servers;
}
function omitUnbrokeredZCodeCuaAgentMcpServers(servers) {
  if (!servers || servers.length === 0) return servers;
  let kept = servers.filter((server) => !isUnbrokeredZCodeCuaAgentMcpServer(server));
  return kept.length === servers.length ? servers : kept;
}
async function restartCuaHelperPreservingTransport(host, beforeFreshStart) {
  let fired = false,
    once = () => {
      fired || ((fired = true), beforeFreshStart());
    },
    outcome = await (host.restartAfterCurrentStartPreservingTransport
      ? host.restartAfterCurrentStartPreservingTransport({ beforeFreshStart: once })
      : (async () => (once(), { handle: await host.restartAfterCurrentStart(), reused: false }))());
  if (!outcome.reused && !fired)
    throw new BrokerError(
      "launch_failed",
      "Computer Use Helper fresh permission restart launched before the unavailable generation was published",
    );
  return outcome;
}
function createCuaProductMcpServerResolver(host, options = {}) {
  let startInFlight = null,
    restartInFlight = null,
    grantRestartInFlight = null,
    reconcileInFlight = null,
    anonymousGrantSeq = 0,
    grantTail = Promise.resolve(),
    grantInFlightBySession = /* @__PURE__ */ new Map(),
    seenGrantSessions = /* @__PURE__ */ new Set();
  function startHelper() {
    if (grantRestartInFlight) return grantRestartInFlight.then((result) => result.handle);
    if (startInFlight) return startInFlight;
    let pending = host.start().finally(() => {
      startInFlight === pending && (startInFlight = null);
    });
    return ((startInFlight = pending), pending);
  }
  function restartHelper() {
    if (restartInFlight) return restartInFlight;
    let prior = grantRestartInFlight,
      pending = (async () => (
        prior && (await prior.catch(() => {})),
        (
          await restartCuaHelperPreservingTransport(host, () =>
            markCuaProductHelperAgentEnvUnavailable(host),
          )
        ).handle
      ))().finally(() => {
        restartInFlight === pending && (restartInFlight = null);
      });
    return ((restartInFlight = pending), pending);
  }
  function restartHelperAfterPermissionGrant() {
    if (grantRestartInFlight) return grantRestartInFlight;
    let prior = restartInFlight,
      pending = (async () => (
        prior && (await prior.catch(() => {})),
        restartCuaHelperPreservingTransport(host, () =>
          markCuaProductHelperAgentEnvUnavailable(host),
        )
      ))().finally(() => {
        grantRestartInFlight === pending && (grantRestartInFlight = null);
      });
    return ((grantRestartInFlight = pending), pending);
  }
  function currentLifecyclePromise() {
    return grantRestartInFlight
      ? grantRestartInFlight.then((result) => result.handle)
      : (restartInFlight ?? startInFlight);
  }
  async function recoverHelper() {
    (await restartHelper(), await reconcileSpawnAdmissionIfNeeded());
  }
  async function recoverAfterPermissionGrant() {
    (await restartHelperAfterPermissionGrant(), await reconcileSpawnAdmissionIfNeeded());
  }
  function restartAfterPermissionGrant(onboardingSessionId) {
    let sessionKey = onboardingSessionId?.trim() || `anonymous-grant-${++anonymousGrantSeq}`;
    if (seenGrantSessions.has(sessionKey)) return Promise.resolve();
    let inFlight = grantInFlightBySession.get(sessionKey);
    if (inFlight) return inFlight;
    let prior = grantTail,
      tracked = (async () => {
        if (
          (await prior.catch(() => {}),
          await recoverAfterPermissionGrant(),
          seenGrantSessions.add(sessionKey),
          seenGrantSessions.size > 64)
        ) {
          let oldest = seenGrantSessions.values().next().value;
          oldest && seenGrantSessions.delete(oldest);
        }
      })().finally(() => {
        grantInFlightBySession.get(sessionKey) === tracked &&
          grantInFlightBySession.delete(sessionKey);
      });
    return (
      grantInFlightBySession.set(sessionKey, tracked),
      (grantTail = tracked.catch(() => {})),
      tracked
    );
  }
  function readLiveHelperTuple() {
    let running = host.running,
      socketPath = host.socketPath,
      pluginAuthority = host.pluginAuthority;
    return !running || !socketPath || !pluginAuthority ? null : { socketPath, pluginAuthority };
  }
  function helperTupleChanged(tuple) {
    let live = readLiveHelperTuple();
    return (
      live !== null &&
      (live.socketPath !== tuple.socketPath || live.pluginAuthority !== tuple.pluginAuthority)
    );
  }
  async function reconcileSpawnAdmissionIfNeeded() {
    for (;;) {
      if (!reconcileInFlight) {
        if (!hasCuaProductHelperAgentEnvUnavailable(host)) return;
        reconcileInFlight = (async () => {
          for (;;) {
            let pending = currentLifecyclePromise();
            if (pending) {
              await waitForCuaHelperStartup(pending);
              continue;
            }
            let generation = pendingCuaProductHelperRecoveryGeneration(host);
            if (generation === null) return;
            readLiveHelperTuple() && commitCuaProductHelperRecoveryGeneration(host, generation);
            return;
          }
        })().finally(() => {
          reconcileInFlight = null;
        });
      }
      if ((await reconcileInFlight, !hasCuaProductHelperAgentEnvUnavailable(host))) return;
    }
  }
  async function stabilizeHelperTuple() {
    for (;;) {
      let pending = currentLifecyclePromise();
      if (pending) {
        try {
          await waitForCuaHelperStartup(pending);
        } catch (error) {
          throw (
            hasCuaProductHelperAgentEnvUnavailable(host) ||
              markCuaProductHelperAgentEnvUnavailable(host),
            error
          );
        }
        continue;
      }
      if (
        (await reconcileSpawnAdmissionIfNeeded(),
        currentLifecyclePromise() || hasCuaProductHelperAgentEnvUnavailable(host))
      )
        continue;
      let live = readLiveHelperTuple();
      if (live) return live;
      throw (
        markCuaProductHelperAgentEnvUnavailable(host),
        new BrokerError(
          "launch_failed",
          "ZCode Computer Use lifecycle completed without a live broker credential tuple",
        )
      );
    }
  }
  async function ensureHelperReady() {
    let live = readLiveHelperTuple();
    if (!currentLifecyclePromise() && live)
      try {
        await host.checkHealth(1e3);
      } catch {
        if (options.hasActiveTurn?.())
          throw new BrokerError(
            "restart_deferred_active_turn",
            "cua helper is unhealthy but an agent turn is active; deferring restart to the next request boundary",
          );
        !currentLifecyclePromise() && !helperTupleChanged(live) && restartHelper();
      }
    else !currentLifecyclePromise() && !live && startHelper();
    return stabilizeHelperTuple();
  }
  function warmHelperForBuiltInPlugin() {
    host.running || currentLifecyclePromise() || startHelper().catch(() => {});
  }
  async function resolveMcpServersImpl(servers) {
    let candidates = servers?.filter(isPotentialZCodeCuaAgentMcpServer);
    if (!servers || !candidates?.length) {
      if (!host.running) return (warmHelperForBuiltInPlugin(), servers);
      try {
        await ensureHelperReady();
      } catch {}
      return servers;
    }
    let authority = host.pluginAuthority ?? void 0;
    if (
      !candidates.some(
        (server) =>
          isOfficialZCodeCuaPluginCandidate(server) &&
          isAuthorizedOfficialZCodeCuaPluginServer(server, authority),
      )
    )
      return servers.filter((server) => !isPotentialZCodeCuaAgentMcpServer(server));
    let tuple;
    try {
      tuple = await ensureHelperReady();
    } catch {
      return (
        hasCuaProductHelperAgentEnvUnavailable(host) ||
          markCuaProductHelperAgentEnvUnavailable(host),
        servers.filter((server) => !isPotentialZCodeCuaAgentMcpServer(server))
      );
    }
    let filtered = servers.filter(
      (server) =>
        !isPotentialZCodeCuaAgentMcpServer(server) ||
        isAuthorizedOfficialZCodeCuaPluginServer(server, tuple.pluginAuthority),
    );
    return injectPermissionBrokerAgentMcpServers(filtered, tuple);
  }
  return {
    async resolveMcpServers(servers) {
      let resolved = await resolveMcpServersImpl(servers);
      return omitUnbrokeredZCodeCuaAgentMcpServers(resolved);
    },
    async restart() {
      await recoverHelper();
    },
    async restartAfterPermissionGrant(onboardingSessionId) {
      await restartAfterPermissionGrant(onboardingSessionId);
    },
    async reconcileRecoveredHelper() {
      !currentLifecyclePromise() &&
        hasCuaProductHelperAgentEnvUnavailable(host) &&
        readLiveHelperTuple() &&
        (await reconcileSpawnAdmissionIfNeeded());
    },
  };
}
function isScreenCaptureProbeSuccess(probe) {
  return !!probe && typeof probe == "object" && probe.ok === true;
}
export {
  clearCuaProductHelperAgentEnvUnavailable,
  createCuaProductMcpServerResolver,
  cuaBrokerRefreshMarkerPath,
  hasCuaProductHelperAgentEnvUnavailable,
  isScreenCaptureProbeSuccess,
  markCuaProductHelperAgentEnvUnavailable,
  publishCuaBrokerRefreshMarker,
  waitForCuaHelperStartup,
};

export { CuaHelperLifecycleManager } from "./host-lifecycle.js";
export {
  CuaProductHelperWorkspaceRegistry,
  isOfficialCuaPluginEnabledForWorkspace,
} from "./host-workspaces.js";
