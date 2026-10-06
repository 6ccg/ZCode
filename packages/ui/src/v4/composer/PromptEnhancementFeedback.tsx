import { useState } from "react";
import { InfoIcon, XIcon } from "lucide-react";
import type { PromptEnhancementController } from "@/hooks/usePromptEnhancement.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { toast } from "@/components/ui/toast.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function PromptEnhancementFeedback({
  controller,
}: {
  controller: PromptEnhancementController;
}) {
  const { intl } = useZCodeIntl();
  const [openedResult, setOpenedResult] = useState<PromptEnhancementController["retained"]>(null);
  const retained = controller.retained;
  if (!controller.error && !retained) return null;
  return (
    <div
      className="flex items-center gap-2 text-ui-base text-warning"
      role="status"
      data-testid="prompt-enhancement-feedback"
    >
      <InfoIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{controller.error ?? retained?.reason}</span>
      {retained ? (
        <>
          <Button type="button" variant="ghost" onClick={() => setOpenedResult(retained)}>
            {intl.formatMessage({ id: "chat.promptEnhancement.viewResult" })}
          </Button>
          <Dialog
            open={openedResult === retained}
            onOpenChange={(open) => {
              if (!open) setOpenedResult(null);
            }}
          >
            <DialogContent className="max-w-3xl" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>
                  {intl.formatMessage({ id: "chat.promptEnhancement.resultTitle" })}
                </DialogTitle>
              </DialogHeader>
              <SettingsFormTextarea
                readOnly
                rows={16}
                value={retained.text}
                aria-label={intl.formatMessage({ id: "chat.promptEnhancement.resultTitle" })}
              />
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(retained.text).then(
                    () => toast(intl.formatMessage({ id: "chat.promptEnhancement.copied" })),
                    () =>
                      toast(intl.formatMessage({ id: "chat.promptEnhancement.copyFailed" }), {
                        variant: "warning",
                      }),
                  );
                }}
              >
                {intl.formatMessage({ id: "chat.promptEnhancement.copy" })}
              </Button>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={controller.dismissFeedback}
        aria-label={intl.formatMessage({ id: "common.close" })}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}
