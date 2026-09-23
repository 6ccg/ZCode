import type { AppSettings } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { BuiltinPromptId, BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export interface ISettingService {
  get(): Promise<AppSettings>;
  getBuiltinPrompts(): Promise<BuiltinPromptOverrides>;
  /** null 恢复当前版本默认；写入独立文件，不修改原版 setting.json。 */
  setBuiltinPrompt(id: BuiltinPromptId, template: string | null): Promise<BuiltinPromptOverrides>;
  update(
    patch: Partial<AppSettings>,
    expectedAccountSettings?: Pick<
      AppSettings,
      "providerFamilyDomain" | "providerFamilyConnectionSelections"
    >,
  ): Promise<void>;
  /** Change the data base directory: copy data from old → new location, then persist the setting. */
  updateDataBaseDir(newDir: string | undefined): Promise<void>;
  ensureDefaultProject(homedir: string): Promise<{ path: string; created: boolean }>;
}

export const ISettingService = createServiceDescriptor<ISettingService>(ServiceChannels.Setting);
