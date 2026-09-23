import { readFile } from "node:fs/promises";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import {
  decodeBuiltinPromptFile,
  getBuiltinPrompt,
  isBuiltinPromptId,
  validateBuiltinPrompt,
  type BuiltinPromptOverrides,
} from "@zcode/shared/builtin-prompts";
import type { ISettingService } from "./setting.js";

export function createBuiltinPromptStore(
  filePath: string,
): Pick<ISettingService, "getBuiltinPrompts" | "setBuiltinPrompt"> {
  const read = async (): Promise<BuiltinPromptOverrides> => {
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    return decodeBuiltinPromptFile(JSON.parse(text));
  };

  return {
    getBuiltinPrompts: read,
    async setBuiltinPrompt(id, template) {
      if (!isBuiltinPromptId(id)) throw new Error(`Unknown built-in prompt: ${id}`);
      if (template !== null) validateBuiltinPrompt(id, template);
      return withFileLock(filePath, async () => {
        const overrides = { ...(await read()) };
        if (template === null || template === getBuiltinPrompt(id).template) delete overrides[id];
        else overrides[id] = template;
        await atomicWritePrivateTextFile(
          filePath,
          JSON.stringify({ schemaVersion: 1, overrides }, null, 2),
        );
        return overrides;
      });
    },
  };
}
