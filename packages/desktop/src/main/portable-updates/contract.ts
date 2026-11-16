import type { ISettingService } from "@zcode/services";
import type { PortableUpdateCommand, PortableUpdateState } from "@zcode/shared";
import { z } from "zod";

export const portableUpdateCommandSchema = z.union([
  z.object({ action: z.enum(["status", "check", "download", "cancel", "install"]) }).strict(),
  z
    .object({
      action: z.literal("configure"),
      preferences: z
        .object({
          source: z.string().trim(),
          automatic: z.boolean(),
          autoDownload: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);

export interface PortableRelease {
  version: string;
  sourceCommit: string;
  publishedAt: string;
  url: string;
  sha256: string;
}
export interface PreparedPortableUpdate {
  workspace: string;
  target: string;
  staged: string;
  backup: string;
  resultFile: string;
  executable: string;
  managed: string[];
}

export interface PortableUpdaterOptions {
  settings: Pick<ISettingService, "get" | "update">;
  current: { version: string; commit: string; buildTime: string };
  target: string;
  supported: boolean;
  cacheDir: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  prepare: (
    release: PortableRelease,
    archive: string,
    signal: AbortSignal,
  ) => Promise<PreparedPortableUpdate>;
  install: (plan: PreparedPortableUpdate) => Promise<void>;
  canInstall: () => boolean;
  broadcast: (state: PortableUpdateState) => void;
  onPreferencesChanged: () => void;
}

export interface DesktopPortableUpdatesContract {
  /** 初始化只读取设置；来源为空时不建立网络任务。 */
  initialize(): Promise<void>;
  /** 配置写入完成后返回快照；检查和下载去重，安装须已有 ready 包。 */
  execute(command: PortableUpdateCommand): Promise<PortableUpdateState>;
  /** Host 已写入设置时刷新，只读取，不另建写入路径。 */
  reloadPreferences(): Promise<void>;
  /** 进程退出时释放定时器和未完成请求。 */
  dispose(): Promise<void>;
}
