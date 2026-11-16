export function isCuaPermissionStatusAvailable(result) {
  // 成功状态的 available 可省略；不能把 Windows 的真实权限报告误判为不可用。
  return (
    Boolean(result) &&
    typeof result === "object" &&
    result.available !== false &&
    typeof result.accessibility === "string" &&
    typeof result.screenRecording === "string"
  );
}

export function shouldRunCuaScreenCaptureProbe(state, options) {
  return options?.includeFunctionalProbes === true && state !== "denied";
}
