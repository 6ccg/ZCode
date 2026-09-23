import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  BUILTIN_PROMPT_FILE_NAME,
  decodeBuiltinPromptFile,
  type BuiltinPromptSource,
} from "@zcode/shared/builtin-prompts";

/** 只读当前执行端 SettingService 的存储；不从连接它的客户端复制配置。 */
export function createNodeBuiltinPromptSource(
  options: { env?: NodeJS.ProcessEnv } = {},
): BuiltinPromptSource {
  const env = options.env ?? process.env;
  const home =
    env.ZCODE_DESKTOP_HOME_DIR?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  const path = join(home, ".zcode", "v2", BUILTIN_PROMPT_FILE_NAME);
  return {
    async readOverrides() {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
      }
      return decodeBuiltinPromptFile(JSON.parse(text));
    },
  };
}
