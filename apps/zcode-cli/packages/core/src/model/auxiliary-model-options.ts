import type { Model, ModelOptions } from "@zcode/contracts";

const AUXILIARY_MAX_OUTPUT_TOKENS = 5_000;

/**
 * 未单独配置的辅助调用使用最低公开档位；标题和 Git 可传入用户明确选择的档位。
 * 输出预算仍受模型上限约束，不能按 disabled/off 等名字推断协议行为。
 */
export function auxiliaryModelOptions(
  model: Model,
  explicitReasoningLevel?: string,
): Required<ModelOptions> {
  return {
    // 用户选定的辅助档位必须保留；未配置的旧调用继续采用最低档，不影响搜索/记忆等用途。
    reasoningLevel: explicitReasoningLevel ?? model.optionSpecs.reasoningLevel.values[0]!,
    maxOutputTokens: Math.min(AUXILIARY_MAX_OUTPUT_TOKENS, model.optionSpecs.maxOutputTokens.max),
  };
}
