import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  BUILTIN_PROMPTS,
  getBuiltinPrompt,
  validateBuiltinPrompt,
  type BuiltinPromptId,
} from "@zcode/shared/builtin-prompts";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useBuiltinPrompts } from "@/hooks/useBuiltinPrompts.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { SettingsFormTextarea } from "./SettingsFormTextarea.js";

const GROUPS = ["main", "subagent", "auxiliary"] as const;

export function BuiltinPromptsSection({
  navigationGuardRef,
}: {
  navigationGuardRef: RefObject<(() => Promise<boolean>) | null>;
}) {
  const { intl, locale } = useZCodeIntl();
  const { overrides, loading, error, refresh, save } = useBuiltinPrompts();
  const confirm = useConfirmDialog();
  const [selectedId, setSelectedId] = useState<BuiltinPromptId>("main.prefix");
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDefault, setShowDefault] = useState(false);
  const definition = getBuiltinPrompt(selectedId);
  const saved = overrides[selectedId] ?? definition.template;
  const text = draft ?? saved;
  const dirty = draft !== null && draft !== saved;
  const message = (key: string) => intl.formatMessage({ id: `settings.builtinPrompts.${key}` });
  let validationError: string | null = null;
  try {
    validateBuiltinPrompt(selectedId, text);
  } catch (cause) {
    validationError = cause instanceof Error ? cause.message : String(cause);
  }

  const canLeave = useCallback(async () => {
    if (saving) return false;
    if (!dirty) return true;
    return confirm({
      title: intl.formatMessage({ id: "settings.builtinPrompts.unsavedTitle" }),
      description: intl.formatMessage({ id: "settings.builtinPrompts.unsavedDescription" }),
      confirmLabel: intl.formatMessage({ id: "settings.builtinPrompts.discard" }),
      confirmVariant: "destructive",
    });
  }, [saving, dirty, confirm, intl]);

  useEffect(() => {
    navigationGuardRef.current = canLeave;
    return () => {
      if (navigationGuardRef.current === canLeave) navigationGuardRef.current = null;
    };
  }, [canLeave, navigationGuardRef]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  async function select(id: BuiltinPromptId) {
    if (id === selectedId || !(await canLeave())) return;
    setSelectedId(id);
    setDraft(null);
    setShowDefault(false);
  }

  async function commit(reset: boolean) {
    if (saving || loading || error) return;
    if (!reset && validationError) return;
    if (
      reset &&
      !(await confirm({
        title: message("restore"),
        description: message("restoreDescription"),
        confirmLabel: message("restore"),
      }))
    )
      return;
    setSaving(true);
    try {
      await save(selectedId, reset ? null : text);
      setDraft(null);
      setShowDefault(false);
      toast(message("saved"));
    } catch (cause) {
      toast(
        intl.formatMessage(
          { id: "settings.builtinPrompts.saveError" },
          { error: cause instanceof Error ? cause.message : String(cause) },
        ),
        { variant: "warning" },
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4" data-testid="builtin-prompts-settings">
      <div className="space-y-1 text-ui-base text-foreground-subtle">
        <p>{message("scope")}</p>
        <p>{message("activation")}</p>
      </div>
      {error ? (
        <div role="alert" className="flex items-center gap-2 text-ui-base text-destructive">
          <span>{error}</span>
          <Button variant="outline" onClick={() => void refresh()}>
            {message("retry")}
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p className="text-ui-base text-foreground-subtle">{message("loading")}</p>
      ) : (
        <div className="flex flex-wrap gap-5">
          <nav aria-label={message("title")} className="w-56 shrink-0 space-y-4">
            {GROUPS.map((group) => (
              <div key={group} className="space-y-1">
                <h3 className="px-2 py-1 text-ui-caption text-foreground-subtle">
                  {message(`group.${group}`)}
                </h3>
                {BUILTIN_PROMPTS.filter((item) => item.group === group).map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    aria-current={item.id === selectedId ? "page" : undefined}
                    data-testid={`builtin-prompt-${item.id}`}
                    disabled={saving}
                    className={cn(
                      "h-auto w-full justify-between gap-2 whitespace-normal px-2 py-2 text-left text-ui-base",
                      item.id === selectedId && "bg-accent",
                    )}
                    onClick={() => void select(item.id)}
                  >
                    <span>{item.title[locale]}</span>
                    <span className="shrink-0 text-ui-xs text-foreground-subtle">
                      {message(overrides[item.id] !== undefined ? "modified" : "default")}
                    </span>
                  </Button>
                ))}
              </div>
            ))}
          </nav>
          <div className="min-w-0 flex-1 basis-96 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-ui-lg font-medium">{definition.title[locale]}</h3>
              <Button
                variant="ghost"
                onClick={() => setShowDefault((value) => !value)}
                disabled={saving}
              >
                {message(showDefault ? "backToEdit" : "viewDefault")}
              </Button>
            </div>
            {selectedId === "main.sessionGuidance" ? (
              <p className="text-ui-caption text-foreground-subtle">{message("guidanceHint")}</p>
            ) : null}
            {selectedId === "auxiliary.title" ||
            selectedId === "auxiliary.gitCommit" ||
            selectedId === "auxiliary.compact" ? (
              <p className="text-ui-caption text-foreground-subtle">
                {message(`format.${selectedId.split(".")[1]}`)}
              </p>
            ) : null}
            {definition.variables.length ? (
              <div className="space-y-1 text-ui-caption text-foreground-subtle">
                <p>{message("variables")}</p>
                {definition.variables.map((variable) => (
                  <p key={variable}>
                    <code>{`{{${variable}}}`}</code> — {message(`variable.${variable}`)}
                  </p>
                ))}
              </div>
            ) : null}
            <SettingsFormTextarea
              aria-label={showDefault ? message("viewDefault") : message("editor")}
              data-testid="builtin-prompt-editor"
              rows={22}
              spellCheck={false}
              readOnly={showDefault}
              disabled={saving || Boolean(error)}
              className="min-h-80 font-mono"
              value={showDefault ? definition.template : text}
              onChange={(event) => setDraft(event.target.value)}
            />
            {validationError && !showDefault ? (
              <p role="alert" className="text-ui-caption text-destructive">
                {validationError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void commit(false)}
                disabled={
                  saving || !dirty || Boolean(validationError) || Boolean(error) || showDefault
                }
              >
                {message(saving ? "saving" : "save")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(null);
                  setShowDefault(false);
                }}
                disabled={saving || !dirty}
              >
                {message("discard")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void commit(true)}
                disabled={
                  saving || Boolean(error) || (overrides[selectedId] === undefined && !dirty)
                }
              >
                {message("restore")}
              </Button>
              {dirty ? (
                <span className="text-ui-caption text-foreground-subtle">{message("unsaved")}</span>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
