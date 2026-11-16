import { useMemo, useState } from "react";
import type { ModelSelection, ProviderSettingsView } from "@zcode/provider";
import { ModelConfigSelect } from "@/ModelConfigSelect.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { encodeCustomModelValue, decodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";

export function AuxiliaryModelSelector({
  view,
  onSave,
}: {
  view: ProviderSettingsView;
  onSave: (selection: ModelSelection | null) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = view.auxiliaryModelSelection;
  const groups = useMemo(
    () =>
      view.providers
        .filter((provider) => provider.executable)
        .map((provider) => ({
          key: provider.providerId,
          label: provider.providerName || provider.providerId,
          items: provider.models
            .filter((model) => model.selectable)
            .map((model) => ({
              key: model.modelId,
              name: model.modelId,
              value: encodeCustomModelValue(provider.providerId, model.modelId),
              supportsVisionInput:
                model.effectiveConfig.properties?.inputFormat?.supportsImage === true,
            })),
        }))
        .filter((group) => group.items.length),
    [view],
  );
  const currentModel = selected
    ? view.providers
        .find((p) => p.providerId === selected.providerId)
        ?.models.find((m) => m.modelId === selected.modelId && m.selectable)
    : undefined;
  const levels = currentModel?.effectiveConfig.optionSpecs?.reasoningLevel?.values ?? [];
  const valid =
    !selected ||
    (currentModel &&
      selected.options?.reasoningLevel &&
      levels.includes(selected.options.reasoningLevel));
  const followLabel = intl.formatMessage({ id: "settings.modelProvider.auxiliaryFollow" });
  const save = async (selection: ModelSelection | null) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(selection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="text-ui-base font-medium">
        {intl.formatMessage({ id: "settings.modelProvider.auxiliaryTitle" })}
      </div>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.auxiliaryDescription" })}
      </p>
      <div className="flex items-center gap-3">
        <ModelConfigSelect
          modelGroups={groups}
          normalizedValue={
            selected ? encodeCustomModelValue(selected.providerId, selected.modelId) : "follow"
          }
          triggerLabel={selected?.modelId ?? followLabel}
          showManageModelsAction={false}
          lockReasonMessage=""
          isItemLocked={() => false}
          disabled={saving}
          labelVisibilityClassName="inline-flex"
          triggerTestId="auxiliary-model-select"
          leadingItems={[{ key: "follow", value: "follow", name: followLabel }]}
          onValueChange={(value) => {
            if (value === "follow") {
              void save(null);
              return;
            }
            const parsed = decodeCustomModelValue(value);
            if (!parsed?.modelName) return;
            const model = view.providers
              .find((p) => p.providerId === parsed.providerId)
              ?.models.find((m) => m.modelId === parsed.modelName);
            const levels = model?.effectiveConfig.optionSpecs?.reasoningLevel?.values ?? [];
            const reasoningLevel =
              model?.defaultReasoningLevel && levels.includes(model.defaultReasoningLevel)
                ? model.defaultReasoningLevel
                : levels[0];
            if (reasoningLevel)
              void save({
                providerId: parsed.providerId,
                modelId: parsed.modelName,
                options: { reasoningLevel },
              });
          }}
        />
        {selected ? (
          <Select
            disabled={saving || !currentModel}
            value={selected.options?.reasoningLevel ?? ""}
            onValueChange={(reasoningLevel) =>
              void save({ ...selected, options: { reasoningLevel } })
            }
          >
            <SelectTrigger
              className="w-40"
              data-testid="auxiliary-reasoning-select"
              aria-label={intl.formatMessage({ id: "settings.modelProvider.auxiliaryReasoning" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {levels.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {error || !valid ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error ?? intl.formatMessage({ id: "settings.modelProvider.auxiliaryUnavailable" })}
        </p>
      ) : null}
    </div>
  );
}
