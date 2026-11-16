import { useRef, useState, type RefObject } from "react";
import { getPromptEnhancementPromptIds, type PromptEnhancementMode } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useProviderSettingsServiceView } from "@/hooks/useProviderSettingsView.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { AuxiliaryModelSelector } from "./model-provider-section/AuxiliaryModelSelector.js";
import { BuiltinPromptsSection } from "./BuiltinPromptsSection.js";

export function PromptEnhancementSection({
  initialMode = "organize",
  navigationGuardRef,
}: {
  initialMode?: PromptEnhancementMode;
  navigationGuardRef: RefObject<(() => Promise<boolean>) | null>;
}) {
  const { intl } = useZCodeIntl();
  const { providerSettingsService } = useBaseWorkspaceServices();
  const providerRead = useProviderSettingsServiceView(providerSettingsService);
  const [mode, setMode] = useState(initialMode);
  const changingMode = useRef(false);
  return (
    <section className="space-y-4" data-testid="prompt-enhancement-settings">
      <p className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.promptEnhancement.description" })}
      </p>
      {providerRead.state.status === "ready" ? (
        <AuxiliaryModelSelector
          purpose="enhancement"
          view={providerRead.state.view}
          onSave={async (selection) => {
            providerRead.commit(
              await providerSettingsService.savePromptEnhancementModelSelection(selection),
            );
          }}
        />
      ) : providerRead.state.status === "error" ? (
        <div className="flex items-center gap-2 text-ui-base text-warning" role="alert">
          <span>{providerRead.state.error.message}</span>
          <Button type="button" variant="outline" onClick={providerRead.reload}>
            {intl.formatMessage({ id: "settings.builtinPrompts.retry" })}
          </Button>
        </div>
      ) : (
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.promptEnhancement.modelLoading" })}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.promptEnhancement.followDescription" })}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setPendingSettingsSectionIntent("modelProvider")}
        >
          {intl.formatMessage({ id: "settings.promptEnhancement.manageModels" })}
        </Button>
      </div>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          if (value !== "organize" && value !== "expand") return;
          if (value === mode) return;
          void (async () => {
            // Tabs 的聚焦与点击可能连续触发同一次切换；未保存确认只允许一个请求。
            if (changingMode.current) return;
            changingMode.current = true;
            try {
              if (navigationGuardRef.current && !(await navigationGuardRef.current())) return;
              setMode(value);
            } finally {
              changingMode.current = false;
            }
          })();
        }}
      >
        <TabsList>
          <TabsTrigger value="organize" data-testid="enhancement-prompt-organize">
            {intl.formatMessage({ id: "settings.promptEnhancement.organize" })}
          </TabsTrigger>
          <TabsTrigger value="expand" data-testid="enhancement-prompt-expand">
            {intl.formatMessage({ id: "settings.promptEnhancement.expand" })}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <BuiltinPromptsSection
        key={mode}
        promptIds={getPromptEnhancementPromptIds(mode)}
        navigationGuardRef={navigationGuardRef}
      />
    </section>
  );
}
