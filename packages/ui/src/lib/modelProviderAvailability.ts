import type { ModelSelectionView, ProviderSettingsView } from "@zcode/services";
import type { ModelSelection } from "@zcode/shared";

/** 辅助文本操作必须同时满足 Provider、模型和已选思考档位可用。 */
export function isExecutableTextModelSelection(
  view: ProviderSettingsView,
  selection: ModelSelection,
): boolean {
  const provider = view.providers.find((entry) => entry.providerId === selection.providerId);
  const model = provider?.models.find((entry) => entry.modelId === selection.modelId);
  const level = selection.options?.reasoningLevel;
  return Boolean(
    provider?.executable &&
    model?.selectable &&
    level &&
    model.effectiveConfig.optionSpecs?.reasoningLevel?.values?.includes(level),
  );
}

interface ProviderAvailabilityState {
  readonly source: "registry";
  readonly hydrated: boolean;
  readonly providerCount: number;
  readonly hasUsableProvider: boolean;
}

export function resolveProviderAvailabilityState(params: {
  modelSelectionView: ModelSelectionView | null;
}): ProviderAvailabilityState {
  const providers = params.modelSelectionView?.providers ?? [];
  return {
    source: "registry",
    hydrated: params.modelSelectionView !== null,
    providerCount: providers.length,
    hasUsableProvider:
      params.modelSelectionView !== null &&
      providers.some((provider) => provider.models.length > 0),
  };
}
