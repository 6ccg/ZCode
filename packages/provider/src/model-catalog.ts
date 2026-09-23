import { z } from "zod";
import { modelConfigDataSchema } from "@zcode/shared/model-config";
import {
  ModelConfig,
  ModelConfigRules,
  type ModelConfigObject,
  type ModelConfigRuleResolutionInput,
} from "./config/model-config.js";

export const modelCatalogEntrySchema = z
  .object({
    modelId: z.string().trim().min(1),
    available: z.boolean(),
    defaultReasoningLevel: z.string().min(1).optional(),
    config: modelConfigDataSchema.transform((config) => {
      // 目录空值表示未提供能力，不能覆盖 ZCode 默认值并使模型被 Registry 排除。
      // 同一解析边界也规范化旧快照，文件仓库会将清理结果一次性写回。
      if (config.properties?.contextWindow === null) delete config.properties.contextWindow;
      if (config.optionSpecs?.maxOutputTokens?.max === null)
        delete config.optionSpecs.maxOutputTokens.max;
      return config;
    }),
  })
  .strict();
export const modelCatalogSchema = z
  .object({
    source: z.literal("modellink"),
    fetchedAt: z.string().datetime().nullable(),
    models: z.array(modelCatalogEntrySchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (new Set(catalog.models.map((model) => model.modelId)).size !== catalog.models.length)
      context.addIssue({ code: "custom", message: "模型目录含重复 modelId" });
  });
export const modelCatalogsSchema = z.record(z.string().min(1), modelCatalogSchema);
export type ModelCatalogEntry = Readonly<z.infer<typeof modelCatalogEntrySchema>>;
export type ModelCatalog = Readonly<z.infer<typeof modelCatalogSchema>>;
export type ModelCatalogs = Readonly<Record<string, ModelCatalog>>;
export const emptyModelLinkCatalog = (): ModelCatalog => ({
  source: "modellink",
  fetchedAt: null,
  models: [],
});

const mediaPolicy = ModelConfig.fromData({
  properties: {
    inputFormat: { supportsAudio: false, supportsVideo: false, supportsPdf: false },
  },
});
const defaults = ModelConfig.fromData({
  properties: {
    supportsJsonSchemaOutput: true,
    supportsNativeWebSearch: false,
    inputFormat: { supportsAudio: false, supportsVideo: false, supportsPdf: false },
  },
});

/** 目录推荐与个人覆盖分别保有一份事实，避免刷新覆盖手动模式或恢复过期的名称猜测。 */
export function resolveCatalogModelConfig(input: {
  identity: ModelConfigRuleResolutionInput;
  builtin: ModelConfigRules;
  personal: ModelConfigRules;
  catalogs?: ModelCatalogs;
}): { inherited: ModelConfig; effective: ModelConfig } {
  const { identity } = input;
  const catalog = input.catalogs?.[identity.providerId];
  let inherited = input.builtin.resolve(identity);
  if (catalog) {
    inherited = inherited.overlay(defaults);
    const model = catalog.models.find((item) => item.modelId === identity.modelId);
    if (model) inherited = inherited.overlay(ModelConfig.fromData(model.config));
    inherited = inherited.overlay(mediaPolicy);
  }
  const rules = new ModelConfigRules([
    {
      type: "provider-model",
      providerId: identity.providerId,
      modelId: identity.modelId,
      config: inherited,
    },
  ]);
  let effective = ModelConfigRules.composeEffective(rules, input.personal).resolve(identity);
  if (catalog) effective = effective.overlay(mediaPolicy);
  return { inherited, effective };
}

const remoteModelSchema = z.object({
  id: z.string().trim().min(1),
  modellink: z.object({
    preferred_protocol: z.enum(["chat_completions", "responses", "anthropic_messages", ""]),
    protocols: z.record(z.string(), z.record(z.string(), z.unknown())),
  }),
});
const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/** 只消费访问 Key 可见的公开目录，不靠显示名称或 Muse 前缀猜协议。 */
export function normalizeModelLinkCatalog(input: unknown, apiType: string): ModelCatalogEntry[] {
  const protocol =
    apiType === "openai-chat-completions"
      ? "chat_completions"
      : apiType === "openai-responses"
        ? "responses"
        : undefined;
  if (!protocol) throw new Error("ModelLink 渠道只支持 Chat Completions 或 Responses");
  const list = z.object({ data: z.array(z.unknown()) }).parse(input);
  const models: ModelCatalogEntry[] = [];
  for (const raw of list.data) {
    const parsed = remoteModelSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error("ModelLink 目录缺少分协议信息，请更新 ModelLink 的公开模型目录接口");
    if (parsed.data.modellink.preferred_protocol !== protocol) continue;
    const data = parsed.data.modellink.protocols[protocol];
    if (!data) throw new Error(`ModelLink 模型 ${parsed.data.id} 缺少 ${protocol} 能力`);
    const efforts = Array.isArray(data.supported_reasoning_efforts)
      ? [
          ...new Set(
            data.supported_reasoning_efforts.filter(
              (item): item is string => typeof item === "string" && item.trim().length > 0,
            ),
          ),
        ]
      : [];
    const config: ModelConfigObject = {
      enabled: true,
      properties: {
        contextWindow: positive(data.context_length),
        supportsToolCall: data.supports_tool_calling !== false,
        supportsJsonSchemaOutput: data.supports_structured_output !== false,
        supportsNativeWebSearch: data.supports_web_search === true,
        supportsMidConversationSystem: false,
        requiresMfjsToolSchema: false,
        inputFormat: {
          supportsText: true,
          supportsImage: data.supports_vision === true,
          supportsAudio: false,
          supportsVideo: false,
          supportsPdf: false,
        },
        outputFormat: { supportsText: true },
      },
      optionSpecs: {
        reasoningLevel: {
          values: efforts.length ? efforts : ["default"],
          map: !efforts.length
            ? "{}"
            : protocol === "responses"
              ? '{"reasoning":{"effort":reasoningLevel}}'
              : '{"reasoning_effort":reasoningLevel}',
        },
        maxOutputTokens: {
          max: positive(data.max_completion_tokens),
          map:
            protocol === "responses"
              ? '{"max_output_tokens":maxOutputTokens}'
              : '{"max_completion_tokens":maxOutputTokens}',
        },
      },
    };
    const defaultReasoningLevel =
      typeof data.default_reasoning_effort === "string" &&
      efforts.includes(data.default_reasoning_effort)
        ? data.default_reasoning_effort
        : undefined;
    models.push({
      modelId: parsed.data.id,
      available: true,
      config,
      ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
    });
  }
  return modelCatalogSchema.parse({ source: "modellink", fetchedAt: null, models }).models;
}
