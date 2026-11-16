// 修改版绿色版更新（portable-updates）的共享类型；官方更新类型仍在上游 update.ts。

export interface PortableUpdatePreferences {
  source: string;
  automatic: boolean;
  autoDownload: boolean;
}

export interface PortableUpdateState {
  revision: number;
  supported: boolean;
  preferences: PortableUpdatePreferences;
  phase: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
  currentVersion: string;
  version?: string;
  progress?: number;
  error?: string;
}

export type PortableUpdateCommand =
  | { action: "status" | "check" | "download" | "cancel" | "install" }
  | { action: "configure"; preferences: PortableUpdatePreferences };