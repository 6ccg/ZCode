import { randomUUID } from "node:crypto";
import { createMacOSBackend } from "./macos-backend.js";

// 同一进程只有一个本地控制者，多个 runtime 不能绕过 lease。
let controller;
const supported = new Set([
  "request_access",
  "list_apps",
  "get_app_state",
  "set_value",
  "perform_action",
  "stop_computer_control",
]);
function result(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}
function failure(code, message, sent = false) {
  return result(
    { code, message, action_sent: sent, dispatch_status: sent ? "possibly_sent" : "not_sent" },
    true,
  );
}
function identity(context) {
  return JSON.stringify([context.workspaceIdentity || context.workspaceKey, context.sessionId]);
}
function appIdentity(ref) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return undefined;
  return JSON.stringify([
    ref.pid ?? null,
    ref.bundle_id ?? null,
    ref.name ?? null,
    ref.window_id ?? null,
  ]);
}
function authorized(context) {
  return (
    context &&
    typeof context.sessionId === "string" &&
    context.sessionId &&
    typeof context.workspaceKey === "string" &&
    context.workspaceKey &&
    context.runtimeScope === "main" &&
    !context.remoteSessionId &&
    context.clientMode !== "web-remote-replayable" &&
    context.deliveryKind !== "web-remote-replayable" &&
    !/^(?:ssh|remote|https?):/i.test(context.workspaceIdentity ?? "")
  );
}
export function createSourceComputerUseRuntime(options = {}) {
  const backend = options.backend ?? createMacOSBackend();
  const runtimeId = randomUUID();
  const observations = new Map();
  const sessionVersions = new Map();
  let queue = Promise.resolve();
  let generation = 0;
  let disposed = false;
  let active;
  function revoke() {
    generation++;
    active?.abort();
    observations.clear();
    if (!active && controller?.runtimeId === runtimeId) controller = undefined;
  }
  async function run(input, admittedGeneration, sessionKey, sessionVersion) {
    if (
      disposed ||
      generation !== admittedGeneration ||
      (sessionVersions.get(sessionKey) ?? 0) !== sessionVersion ||
      input.signal?.aborted
    )
      return failure("CONTROL_STOPPED", "Control was stopped.");
    const context = input.context;
    if (!authorized(context))
      return failure(
        "not_authorized",
        "Source Computer Use requires a trusted local main session.",
      );
    const method = input.toolName;
    if (!supported.has(method))
      return failure(
        "action_unavailable",
        `The experimental macOS AX backend does not support ${method}.`,
      );
    const key = identity(context);
    if (controller && (controller.runtimeId !== runtimeId || controller.key !== key))
      return failure("controller_busy", "Another session owns local control.");
    if (method === "stop_computer_control") {
      revoke();
      return result({ stopped: true, action_sent: false });
    }
    const args = input.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args))
      return failure("invalid_request", "Arguments must be an object.");
    controller = { runtimeId, key };
    active = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, active.signal]) : active.signal;
    const backendContext = { ...context, signal };
    let dispatched = false;
    try {
      let value;
      if (method === "request_access") value = await backend.requestAccess(backendContext);
      else if (method === "list_apps") value = { apps: await backend.listApps(backendContext) };
      else {
        const appKey = appIdentity(args.app_ref);
        if (!appKey) return failure("invalid_request", "An explicit app_ref is required.");
        const observationKey = `${key}:${appKey}`;
        if (method === "get_app_state") {
          if (args.include_screenshot === true)
            return failure(
              "action_unavailable",
              "Screenshots and coordinate control are unavailable. Request AX state without a screenshot.",
            );
          const observed = await backend.getAppState(args, backendContext);
          if (signal.aborted || generation !== admittedGeneration || disposed)
            return failure("CONTROL_STOPPED", "Observation was revoked.");
          const { backendState, ...publicState } = observed;
          value = { ...publicState, state_id: randomUUID(), snapshot_mode: "full" };
          if (args.tree_shown_to_model !== false) {
            observations.clear();
            observations.set(observationKey, { backendState, stateId: value.state_id });
          }
        } else {
          const observed = observations.get(observationKey);
          if (!observed || (args.state_id && args.state_id !== observed.stateId))
            return failure("element_unavailable", "Observe this app again before acting.");
          // 不论成功、取消或结果不确定都消费观察，绝不自动重放动作。
          observations.delete(observationKey);
          dispatched = true;
          value = await backend.act(method, args, backendContext, observed.backendState);
        }
      }
      if (signal.aborted || generation !== admittedGeneration || disposed)
        return failure(
          "CONTROL_STOPPED",
          "Control was revoked; do not retry an uncertain action.",
          dispatched,
        );
      return result(
        value ?? { action_sent: dispatched, dispatch_status: dispatched ? "sent" : "not_sent" },
      );
    } catch (error) {
      // 仅原生 adapter 能证明未下发；未知异常按 possibly_sent 处理。
      return failure(
        error?.code ?? "internal",
        error instanceof Error ? error.message : String(error),
        dispatched && error?.actionSent !== false,
      );
    } finally {
      active = undefined;
      if (generation !== admittedGeneration && controller?.runtimeId === runtimeId)
        controller = undefined;
    }
  }
  return {
    execute(input) {
      const sessionKey = authorized(input?.context) ? identity(input.context) : undefined;
      // stop 在进入队列前撤销该会话，包括尚未获得 lease 的请求。
      if (input?.toolName === "stop_computer_control" && sessionKey) {
        if (controller && (controller.runtimeId !== runtimeId || controller.key !== sessionKey)) {
          return Promise.resolve(failure("controller_busy", "Another session owns local control."));
        }
        sessionVersions.set(sessionKey, (sessionVersions.get(sessionKey) ?? 0) + 1);
        revoke();
        return Promise.resolve(result({ stopped: true, action_sent: false }));
      }
      const sessionVersion = sessionVersions.get(sessionKey) ?? 0;
      const admittedGeneration = generation;
      const pending = queue.then(() => run(input, admittedGeneration, sessionKey, sessionVersion));
      queue = pending.catch(() => undefined);
      return pending;
    },
    async closeSession(context) {
      const key = identity(context);
      sessionVersions.set(key, (sessionVersions.get(key) ?? 0) + 1);
      if (controller?.runtimeId === runtimeId && controller.key === identity(context)) revoke();
    },
    async dispose() {
      disposed = true;
      revoke();
    },
  };
}
