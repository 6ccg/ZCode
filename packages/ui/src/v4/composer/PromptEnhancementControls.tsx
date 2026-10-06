import type { PromptEnhancementMode } from "@zcode/shared";
import type { PromptEnhancementController } from "@/hooks/usePromptEnhancement.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { Spinner } from "@/components/ui/spinner.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingPromptEnhancementIntent } from "@/lib/settingsNavigation.js";
import { useTabStore } from "@/store/TabStoreProvider.js";

const MODES: readonly PromptEnhancementMode[] = ["organize", "expand"];

export function PromptEnhancementControls({
  controller,
  disabled,
  hasText,
}: {
  controller: PromptEnhancementController;
  disabled: boolean;
  hasText: boolean;
}) {
  const { intl } = useZCodeIntl();
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const undoLabel = intl.formatMessage({ id: "chat.promptEnhancement.undo" });
  const stopLabel = intl.formatMessage({ id: "chat.promptEnhancement.stop" });
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      data-testid="prompt-enhancement-controls"
    >
      {MODES.map((mode) => {
        const pending = controller.pendingMode === mode;
        const undo = controller.undoMode === mode;
        const shortLabel = intl.formatMessage({ id: `chat.promptEnhancement.${mode}.short` });
        const title = intl.formatMessage({
          id: `chat.promptEnhancement.${mode}.${pending ? "stop" : undo ? "undo" : "title"}`,
        });
        const blocked =
          !pending &&
          (Boolean(controller.pendingMode) ||
            (!undo && (disabled || !hasText || !controller.canGenerate)));
        const description =
          blocked && !hasText && !undo
            ? intl.formatMessage({ id: "chat.promptEnhancement.empty" })
            : blocked && !controller.canGenerate && !undo
              ? controller.unavailableReason
              : intl.formatMessage({ id: "chat.promptEnhancement.rightClickHint" });
        return (
          <ContextMenu key={mode}>
            <ContextMenuTrigger asChild>
              <span className="inline-flex shrink-0">
                <ControlHintTooltip title={title} description={description}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="default"
                    className="grid grid-cols-1 rounded-lg px-2 text-foreground-subtle"
                    data-testid={`prompt-enhancement-${mode}`}
                    aria-label={title}
                    aria-busy={pending}
                    disabled={blocked}
                    onClick={() => void controller.run(mode)}
                  >
                    {/* 以本地化标签的实际宽度预留空间，避免撤销或加载时按钮和发送箭头跳动。 */}
                    {[shortLabel, undoLabel].map((label) => (
                      <span
                        key={label}
                        aria-hidden="true"
                        className="invisible col-start-1 row-start-1"
                      >
                        {label}
                      </span>
                    ))}
                    <span
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1 inline-flex items-center justify-center gap-1"
                    >
                      <Spinner className="size-3" />
                      {stopLabel}
                    </span>
                    <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1">
                      {pending ? <Spinner className="size-3" /> : null}
                      {pending ? stopLabel : undo ? undoLabel : shortLabel}
                    </span>
                  </Button>
                </ControlHintTooltip>
              </span>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {controller.canIncludeConversation ? (
                <>
                  <ContextMenuItem
                    onSelect={() =>
                      controller.setIncludeConversation(!controller.includeConversation)
                    }
                  >
                    {intl.formatMessage({
                      id: controller.includeConversation
                        ? "chat.promptEnhancement.draftOnly"
                        : "chat.promptEnhancement.includeConversation",
                    })}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              ) : null}
              <ContextMenuItem
                onSelect={() => {
                  setPendingPromptEnhancementIntent(mode);
                  openSettingsTab();
                }}
              >
                {intl.formatMessage({ id: "settings.promptEnhancement.open" })}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </span>
  );
}
