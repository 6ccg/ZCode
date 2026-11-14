import { externalWindowsCuaFunction } from "./src/external-windows-runtime.js";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 公共 Host 通过 broker 入口复用参数契约；占位包仍拒绝真实能力调用。
export { HELPER_GHOST_CURSOR_OVERLAY_ARG } from "./broker-helper-constants.js";

export const BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export const BROKER_UNAVAILABLE_ENV = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";

export class BrokerError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use broker is unavailable.");
    this.name = "BrokerError";
    this.code = options.code ?? "unavailable";
    if (options.details !== undefined) this.details = options.details;
  }
}

export class CuaHelperError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use Helper is unavailable.");
    this.name = "CuaHelperError";
    this.code = options.code ?? "helper_unavailable";
  }
}

export function isCuaHelperError(value) {
  const external = externalWindowsCuaFunction("./broker", "isCuaHelperError");
  return value instanceof CuaHelperError || Boolean(external?.(value));
}

const brokerErrorFactory = (code) => (message, details) =>
  new BrokerError(message ?? code, { code, details });

export const notAuthorized = brokerErrorFactory("not_authorized");
export const notSelectable = brokerErrorFactory("not_selectable");
export const notSettable = brokerErrorFactory("not_settable");
export const elementUnavailable = brokerErrorFactory("element_unavailable");
export const actionUnavailable = brokerErrorFactory("action_unavailable");
export const foregroundRequired = brokerErrorFactory("foreground_required");

export async function callBrokerMethod(_args) {
  const external = externalWindowsCuaFunction("./broker", "callBrokerMethod");
  if (external) return external(...arguments);
  throw new BrokerError("Computer Use is not available in this build.");
}

export async function probeHelperHealth(_socketPath, _options) {
  const external = externalWindowsCuaFunction("./broker", "probeHelperHealth");
  if (external) return external(...arguments);
  return { bundleId: null, pid: null };
}

export function mintBrokerSocketPath(options = {}) {
  const external = externalWindowsCuaFunction("./broker", "mintBrokerSocketPath");
  if (external) return external(...arguments);
  const dir = typeof options.dir === "string" ? options.dir : tmpdir();
  return join(dir, `zcode-cua-broker-${randomUUID()}.sock`);
}

export function resolveBrokerSocketPath(options = {}) {
  const external = externalWindowsCuaFunction("./broker", "resolveBrokerSocketPath");
  if (external) return external(...arguments);
  const env = options.env ?? process.env;
  const fromEnv = env[BROKER_SOCKET_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv;
  return mintBrokerSocketPath(options);
}

export function parseRequestLine(line) {
  const external = externalWindowsCuaFunction("./broker", "parseRequestLine");
  if (external) return external(...arguments);
  // 原占位实现丢失请求 ID；纯解析必须与现有 broker 的数字 ID 和错误信封一致。
  const invalid = (id, message) => ({ ok: false, id, code: "invalid_request", message });
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return invalid(0, "request is not valid JSON");
  }
  if (request === null || typeof request !== "object") {
    return invalid(0, "request must be a JSON object");
  }
  if (!Number.isSafeInteger(request.id) || request.id < 0) {
    return invalid(0, "request.id must be a non-negative safe integer");
  }
  const { id, method, params = {} } = request;
  if (typeof method !== "string" || !method.length) {
    return invalid(id, "request.method must be a non-empty string");
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return invalid(id, "request.params must be an object");
  }
  return { ok: true, request: { id, method, params } };
}

export function okResponse(id, result, presentation) {
  const external = externalWindowsCuaFunction("./broker", "okResponse");
  if (external) return external(...arguments);
  const response = { id, ok: true, result: result ?? null };
  if (presentation !== undefined) response.presentation = presentation;
  return response;
}

export function errorResponse(id, code, message, details) {
  const external = externalWindowsCuaFunction("./broker", "errorResponse");
  if (external) return external(...arguments);
  const response = { id, ok: false, error: { code, message } };
  if (details !== undefined && Object.keys(details).length) {
    response.error.details = { ...details };
  }
  return response;
}

export function errorResponseFromException(id, error) {
  const external = externalWindowsCuaFunction("./broker", "errorResponseFromException");
  if (external) return external(...arguments);
  // 外部 runtime 的 Error 不共享本地构造器；按 Error 的 code 保留服务端分类及投递状态。
  const classified = error instanceof Error && typeof error.code === "string" && error.code.length;
  return errorResponse(
    id,
    classified ? error.code : "internal",
    error instanceof Error ? error.message : String(error),
    classified ? error.details : undefined,
  );
}

export function serializeResponse(response) {
  const external = externalWindowsCuaFunction("./broker", "serializeResponse");
  if (external) return external(...arguments);
  return `${JSON.stringify(response)}\n`;
}

export async function dispatchRequest(_backend, _request) {
  const external = externalWindowsCuaFunction("./broker", "dispatchRequest");
  if (external) return external(...arguments);
  throw new CuaHelperError("Computer Use is not available in this build.");
}

export async function handleRequestLine(_backend, _line) {
  const external = externalWindowsCuaFunction("./broker", "handleRequestLine");
  if (external) return external(...arguments);
  throw new CuaHelperError("Computer Use is not available in this build.");
}

export function isBrokerMethod(_method) {
  const external = externalWindowsCuaFunction("./broker", "isBrokerMethod");
  if (external) return external(...arguments);
  return false;
}

export function isReadOnlyBrokerMethod(_method) {
  const external = externalWindowsCuaFunction("./broker", "isReadOnlyBrokerMethod");
  if (external) return external(...arguments);
  return false;
}
