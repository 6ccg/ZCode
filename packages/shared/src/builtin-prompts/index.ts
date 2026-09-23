import { mainPromptDefinitions } from "./main.js";
import { subagentsPromptDefinitions } from "./subagents.js";
import { auxiliaryPromptDefinitions } from "./auxiliary.js";

export { SECURITY_NOTICE, HARNESS_BLOCK } from "./identity-fragments.js";

export const BUILTIN_PROMPTS = [
  ...mainPromptDefinitions,
  ...subagentsPromptDefinitions,
  ...auxiliaryPromptDefinitions,
] as const;

export type BuiltinPromptId = (typeof BUILTIN_PROMPTS)[number]["id"];
export type BuiltinPromptOverrides = Partial<Record<BuiltinPromptId, string>>;
export const BUILTIN_PROMPT_FILE_NAME = "zcode-modified-prompts.json";
export interface BuiltinPromptSource {
  readOverrides(): Promise<BuiltinPromptOverrides>;
}

export function isBuiltinPromptId(value: string): value is BuiltinPromptId {
  return BUILTIN_PROMPTS.some((entry) => entry.id === value);
}

export function getBuiltinPrompt(id: BuiltinPromptId) {
  const entry = BUILTIN_PROMPTS.find((item) => item.id === id);
  if (!entry) throw new Error(`Unknown built-in prompt: ${id}`);
  return entry;
}

/** 只识别命名占位符，不把 JSON 示例或插入值继续解释为模板。 */
export function validateBuiltinPrompt(id: BuiltinPromptId, template: string): void {
  const entry = getBuiltinPrompt(id);
  if (!template.trim()) throw new Error("Prompt must not be empty");
  const allowed: readonly string[] = entry.variables;
  const used = new Set(
    [...template.matchAll(/\{\{([A-Za-z_][A-Za-z_0-9]*)\}\}/g)].map((m) => m[1]!),
  );
  for (const variable of used) {
    if (!allowed.includes(variable)) throw new Error(`Unknown variable: {{${variable}}}`);
  }
  for (const variable of allowed) {
    if (!used.has(variable)) throw new Error(`Required variable: {{${variable}}}`);
  }
}

export function renderBuiltinPrompt(
  id: BuiltinPromptId,
  overrides?: BuiltinPromptOverrides,
  variables: Readonly<Record<string, string>> = {},
): string {
  const template = overrides?.[id] ?? getBuiltinPrompt(id).template;
  return template.replace(/\{\{([A-Za-z_][A-Za-z_0-9]*)\}\}/g, (_, name: string) => {
    const value = variables[name];
    if (value === undefined) throw new Error(`Missing built-in prompt variable: ${name}`);
    return value;
  });
}

/** 手动配置与 UI 保存使用相同校验，未知条目不作为可执行模板进入运行时。 */
export function parseBuiltinPromptOverrides(value: unknown): BuiltinPromptOverrides {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid built-in prompt overrides");
  }
  const result: BuiltinPromptOverrides = {};
  for (const [id, text] of Object.entries(value)) {
    if (!isBuiltinPromptId(id)) continue;
    if (typeof text !== "string") throw new Error(`Invalid built-in prompt: ${id}`);
    validateBuiltinPrompt(id, text);
    result[id] = text;
  }
  return result;
}

export function decodeBuiltinPromptFile(value: unknown): BuiltinPromptOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid built-in prompt file");
  }
  const file = value as Record<string, unknown>;
  if (file.schemaVersion !== 1) throw new Error("Unsupported built-in prompt file version");
  return parseBuiltinPromptOverrides(file.overrides);
}
