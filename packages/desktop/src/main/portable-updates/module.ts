/**
 * desktop-portable-updates 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const desktopPortableUpdatesModule = {
  id: "desktop-portable-updates",
  requires: ["shared", "services"],
  provides: ["desktop-portable-updates"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
