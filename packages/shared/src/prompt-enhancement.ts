import { z } from "zod";
import { modelSelectionSchema } from "./model-selection.js";
import {
  getBuiltinPrompt,
  renderBuiltinPrompt,
  validateBuiltinPrompt,
  type BuiltinPromptId,
  type BuiltinPromptOverrides,
} from "./builtin-prompts/index.js";
import { PROMPT_ENHANCEMENT_PROMPT_IDS } from "./builtin-prompts/prompt-enhancement.js";

export const promptEnhancementModeSchema = z.enum(["organize", "expand"]);
export type PromptEnhancementMode = z.infer<typeof promptEnhancementModeSchema>;

export const promptEnhancementProtectedContentSchema = z
  .object({
    token: z.string().min(1),
    content: z.string(),
  })
  .strict();
export type PromptEnhancementProtectedContent = z.infer<
  typeof promptEnhancementProtectedContentSchema
>;

export const promptEnhancementTemplatesSchema = z
  .object({
    system: z.string().min(1),
    user: z.string().min(1),
  })
  .strict();
export type PromptEnhancementTemplates = z.infer<typeof promptEnhancementTemplatesSchema>;

/** 只含可序列化数据；取消信号在接收请求的 Host 内创建。 */
export const promptEnhancementInputSchema = z
  .object({
    mode: promptEnhancementModeSchema,
    selection: modelSelectionSchema.refine(
      (selection) => Boolean(selection.options?.reasoningLevel),
      "Reasoning selection is missing",
    ),
    instruction: z.string().refine((value) => value.trim().length > 0, "Instruction is empty"),
    protectedContent: z.array(promptEnhancementProtectedContentSchema),
    context: z.string().optional(),
    templates: promptEnhancementTemplatesSchema,
  })
  .strict();
export type PromptEnhancementInput = z.infer<typeof promptEnhancementInputSchema>;

export function getPromptEnhancementTemplates(
  mode: PromptEnhancementMode,
  overrides: BuiltinPromptOverrides = {},
): PromptEnhancementTemplates {
  const ids = PROMPT_ENHANCEMENT_PROMPT_IDS[mode];
  return {
    system: overrides[ids.system] ?? getBuiltinPrompt(ids.system).template,
    user: overrides[ids.user] ?? getBuiltinPrompt(ids.user).template,
  };
}

export function getPromptEnhancementModeForPrompt(
  id: BuiltinPromptId,
): PromptEnhancementMode | null {
  for (const mode of ["organize", "expand"] as const) {
    const ids = PROMPT_ENHANCEMENT_PROMPT_IDS[mode];
    if (id === ids.system || id === ids.user) return mode;
  }
  return null;
}

export function getPromptEnhancementPromptIds(
  mode: PromptEnhancementMode,
): readonly BuiltinPromptId[] {
  const ids = PROMPT_ENHANCEMENT_PROMPT_IDS[mode];
  return [ids.system, ids.user];
}

export function buildPromptEnhancementMessages(input: PromptEnhancementInput): Array<{
  role: "system" | "user";
  content: string;
}> {
  const ids = PROMPT_ENHANCEMENT_PROMPT_IDS[input.mode];
  validateBuiltinPrompt(ids.system, input.templates.system);
  validateBuiltinPrompt(ids.user, input.templates.user);
  const overrides: BuiltinPromptOverrides = { [ids.user]: input.templates.user };
  return [
    { role: "system", content: input.templates.system },
    {
      role: "user",
      content: renderBuiltinPrompt(ids.user, overrides, {
        input: JSON.stringify({
          instruction: input.instruction,
          protectedContent: input.protectedContent,
        }),
        context: input.context ? JSON.stringify({ reference: input.context }) : "null",
      }),
    },
  ];
}

/** 片段丢失或重复时禁止自动回填；草稿本身仍由编辑器持有。 */
export function restorePromptEnhancementContent(
  text: string,
  protectedContent: readonly PromptEnhancementProtectedContent[],
): string {
  const tokens = new Set<string>();
  for (const entry of protectedContent) {
    if (tokens.has(entry.token) || text.split(entry.token).length !== 2) {
      throw new Error("Prompt enhancement changed protected content");
    }
    tokens.add(entry.token);
  }
  const expected = [...text.matchAll(/\[\[ZCODE_KEEP_[A-Za-z0-9_-]+\]\]/g)];
  if (expected.some((match) => !tokens.has(match[0]))) {
    throw new Error("Prompt enhancement contains unknown protected content");
  }
  // 只替换模型输出中的占位符一次，原代码内的相似字符串不再递归解释。
  if (tokens.size === 0) return text;
  const pattern = new RegExp([...tokens].map(escapeRegExp).join("|"), "g");
  const values = new Map(protectedContent.map((entry) => [entry.token, entry.content]));
  return text.replace(pattern, (token) => values.get(token)!);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
