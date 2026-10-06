import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  getPromptEnhancementTemplates,
  restorePromptEnhancementContent,
  type ModelSelection,
  type PromptEnhancementMode,
} from "@zcode/shared";
import type { IZCodeAgentService } from "@zcode/services";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import type {
  AppliedPromptEnhancement,
  PreparedPromptEnhancement,
  PromptEnhancementEditorApi,
} from "@/prompt-editor/promptEnhancementEditor.js";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "./useWorkspaceServices.js";
import { useProviderSettingsServiceView } from "./useProviderSettingsView.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { isExecutableTextModelSelection } from "@/lib/modelProviderAvailability.js";

interface PendingEnhancement {
  id: string;
  mode: PromptEnhancementMode;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  service: IZCodeAgentService;
  api: PromptEnhancementEditorApi;
  prepared: PreparedPromptEnhancement;
  contextFingerprint: string;
  stale: boolean;
  sent: boolean;
}

interface UndoEnhancement {
  mode: PromptEnhancementMode;
  api: PromptEnhancementEditorApi;
  record: AppliedPromptEnhancement;
}

interface EnhancementState {
  scopeKey: string;
  pending: PendingEnhancement | null;
  undo: UndoEnhancement | null;
  retained: { text: string; reason: string } | null;
  error: string | null;
  includeConversation: boolean;
}

interface Options {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  scopeId: string;
  inputApiRef: MutableRefObject<LexicalChatInputHandle | null>;
  selection?: ModelSelection;
  contextFingerprint: string;
  readReferenceContext(): string;
  readConversationContext(): string;
  canIncludeConversation: boolean;
}

function initialState(scopeKey: string): EnhancementState {
  return {
    scopeKey,
    pending: null,
    undo: null,
    retained: null,
    error: null,
    includeConversation: false,
  };
}

function cancelRemote(operation: PendingEnhancement): void {
  if (!operation.sent) return;
  void operation.service
    .cancelPromptEnhancement({
      workspacePath: operation.workspacePath,
      workspaceIdentity: operation.workspaceIdentity,
      remoteSessionId: operation.remoteSessionId,
      operationId: operation.id,
    })
    .catch((error: unknown) => logger.debug("[PromptEnhancement] 取消通知未完成", { error }));
}

/** 当前 Composer 是草稿、pending 和唯一最近一次增强记录的所有者。 */
export function usePromptEnhancement(options: Options) {
  const { intl } = useZCodeIntl();
  const base = useBaseWorkspaceServices();
  const target = useWorkspaceServicesResolution(
    options.workspacePath,
    options.remoteSessionId,
    options.workspaceIdentity,
  );
  const providerRead = useProviderSettingsServiceView(base.providerSettingsService);
  const scopeKey = JSON.stringify([
    options.workspaceIdentity?.trim() || options.workspacePath,
    options.scopeId,
  ]);
  const [state, setState] = useState(() => initialState(scopeKey));
  const stateRef = useRef(state);
  const mounted = useRef(true);
  const applying = useRef(false);
  const tracking = useRef<{ api: PromptEnhancementEditorApi; dispose(): void } | null>(null);
  const latest = useRef({ options, scopeKey, target });
  latest.current = { options, scopeKey, target };

  const commit = useCallback((next: EnhancementState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);
  const releaseTracking = useCallback(() => {
    tracking.current?.dispose();
    tracking.current = null;
  }, []);
  const releaseIfIdle = useCallback(() => {
    if (!stateRef.current.pending && !stateRef.current.undo) releaseTracking();
  }, [releaseTracking]);
  const track = useCallback(
    (api: PromptEnhancementEditorApi) => {
      if (tracking.current?.api === api) return;
      releaseTracking();
      const dispose = api.subscribe(() => {
        if (applying.current || !mounted.current) return;
        const current = stateRef.current;
        commit({
          ...current,
          undo: null,
          pending: current.pending ? { ...current.pending, stale: true } : null,
        });
        releaseIfIdle();
      });
      tracking.current = { api, dispose };
    },
    [commit, releaseIfIdle, releaseTracking],
  );

  useEffect(() => {
    if (stateRef.current.scopeKey === scopeKey) return;
    const operation = stateRef.current.pending;
    if (operation) cancelRemote(operation);
    releaseTracking();
    commit(initialState(scopeKey));
  }, [commit, releaseTracking, scopeKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const operation = stateRef.current.pending;
      if (operation) cancelRemote(operation);
      releaseTracking();
    };
  }, [releaseTracking]);
  useEffect(() => {
    const current = stateRef.current;
    if (
      current.pending &&
      current.pending.contextFingerprint !== options.contextFingerprint &&
      !current.pending.stale
    ) {
      commit({ ...current, pending: { ...current.pending, stale: true } });
    }
  }, [commit, options.contextFingerprint]);
  useEffect(() => {
    const current = stateRef.current;
    const operation = current.pending;
    if (
      operation &&
      (!target.rpcReady ||
        operation.service !== target.services.zcodeAgentService ||
        operation.remoteSessionId !== (target.remoteSessionId ?? undefined))
    ) {
      cancelRemote(operation);
      commit({ ...current, pending: null });
      releaseIfIdle();
    }
  }, [
    commit,
    releaseIfIdle,
    target.remoteSessionId,
    target.rpcReady,
    target.services.zcodeAgentService,
  ]);

  const stop = useCallback(() => {
    const current = stateRef.current;
    if (!current.pending) return;
    cancelRemote(current.pending);
    commit({ ...current, pending: null, error: null });
    releaseIfIdle();
  }, [commit, releaseIfIdle]);
  const beforeSubmit = useCallback(() => {
    const current = stateRef.current;
    if (current.pending) cancelRemote(current.pending);
    commit({ ...current, pending: null, undo: null, retained: null, error: null });
    releaseTracking();
  }, [commit, releaseTracking]);

  const run = useCallback(
    async (mode: PromptEnhancementMode) => {
      const current = stateRef.current;
      const live = latest.current;
      if (current.scopeKey !== live.scopeKey) return;
      if (current.pending) {
        if (current.pending.mode === mode) stop();
        return;
      }
      const api = live.options.inputApiRef.current?.enhancement;
      if (!api || api.isComposing()) {
        commit({
          ...current,
          error: intl.formatMessage({ id: "chat.promptEnhancement.editorUnavailable" }),
        });
        return;
      }
      if (
        current.undo?.mode === mode &&
        current.undo.api === api &&
        current.scopeKey === live.scopeKey
      ) {
        applying.current = true;
        let restored: boolean;
        try {
          restored = api.restore(current.undo.record);
        } finally {
          applying.current = false;
        }
        commit({
          ...current,
          undo: null,
          error: restored
            ? null
            : intl.formatMessage({ id: "chat.promptEnhancement.undoUnavailable" }),
        });
        releaseIfIdle();
        return;
      }
      if (!live.target.rpcReady) return;
      let prepared: PreparedPromptEnhancement;
      try {
        prepared = api.prepare();
      } catch (cause) {
        commit({
          ...stateRef.current,
          error: intl.formatMessage(
            { id: "chat.promptEnhancement.failed" },
            {
              detail: cause instanceof Error ? cause.message : String(cause),
            },
          ),
        });
        return;
      }
      if (!prepared.instruction.trim()) {
        releaseIfIdle();
        return;
      }
      track(api);
      const operation: PendingEnhancement = {
        id: crypto.randomUUID(),
        mode,
        workspacePath: live.options.workspacePath,
        workspaceIdentity: live.options.workspaceIdentity,
        remoteSessionId: live.target.remoteSessionId ?? undefined,
        service: live.target.services.zcodeAgentService,
        api,
        prepared,
        contextFingerprint: live.options.contextFingerprint,
        stale: false,
        sent: false,
      };
      const fallback = live.options.selection;
      const referenceContext = live.options.readReferenceContext();
      const conversationContext = current.includeConversation
        ? live.options.readConversationContext()
        : "";
      commit({ ...stateRef.current, scopeKey: live.scopeKey, pending: operation, error: null });
      const isCurrent = () =>
        mounted.current &&
        latest.current.scopeKey === live.scopeKey &&
        stateRef.current.pending?.id === operation.id;
      try {
        const [view, overrides] = await Promise.all([
          base.providerSettingsService.getView(),
          base.settingService.getBuiltinPrompts(),
        ]);
        if (!isCurrent()) return;
        const explicit = view.promptEnhancementModelSelection ?? view.auxiliaryModelSelection;
        const selection = explicit ?? fallback;
        if (
          !selection?.options?.reasoningLevel ||
          (explicit && !isExecutableTextModelSelection(view, explicit))
        ) {
          throw new Error(intl.formatMessage({ id: "chat.promptEnhancement.modelUnavailable" }));
        }
        const sent = { ...stateRef.current.pending!, sent: true };
        commit({ ...stateRef.current, pending: sent });
        const result = await operation.service.enhancePrompt({
          workspacePath: operation.workspacePath,
          workspaceIdentity: operation.workspaceIdentity,
          remoteSessionId: operation.remoteSessionId,
          operationId: operation.id,
          request: {
            mode,
            selection,
            instruction: prepared.instruction,
            protectedContent: prepared.protectedContent,
            templates: getPromptEnhancementTemplates(mode, overrides),
            context: [referenceContext, conversationContext].filter(Boolean).join("\n\n"),
          },
        });
        if (!isCurrent()) return;
        let text = result.text;
        let record: AppliedPromptEnhancement | null = null;
        let protectedContentValid = true;
        try {
          text = restorePromptEnhancementContent(result.text, prepared.protectedContent);
        } catch {
          protectedContentValid = false;
        }
        const stillSameEditor = latest.current.options.inputApiRef.current?.enhancement === api;
        if (
          protectedContentValid &&
          stillSameEditor &&
          !stateRef.current.pending?.stale &&
          latest.current.options.contextFingerprint === operation.contextFingerprint &&
          api.isCurrent(prepared)
        ) {
          applying.current = true;
          try {
            record = api.apply(prepared, result.text);
          } finally {
            applying.current = false;
          }
        }
        const next = stateRef.current;
        commit({
          ...next,
          pending: null,
          undo: record ? { mode, api, record } : next.undo,
          retained: record
            ? null
            : {
                text,
                reason: intl.formatMessage({
                  id: protectedContentValid
                    ? "chat.promptEnhancement.resultStale"
                    : "chat.promptEnhancement.protectedChanged",
                }),
              },
        });
      } catch (cause) {
        if (isCurrent()) {
          commit({
            ...stateRef.current,
            pending: null,
            error: intl.formatMessage(
              { id: "chat.promptEnhancement.failed" },
              {
                detail: cause instanceof Error ? cause.message : String(cause),
              },
            ),
          });
        }
      } finally {
        releaseIfIdle();
      }
    },
    [base.providerSettingsService, base.settingService, commit, intl, releaseIfIdle, stop, track],
  );

  const visible = state.scopeKey === scopeKey ? state : initialState(scopeKey);
  const configured =
    providerRead.state.status === "ready"
      ? (providerRead.state.view.promptEnhancementModelSelection ??
        providerRead.state.view.auxiliaryModelSelection)
      : undefined;
  return {
    pendingMode: visible.pending?.mode ?? null,
    undoMode: visible.undo?.mode ?? null,
    retained: visible.retained,
    error: visible.error,
    includeConversation: visible.includeConversation,
    canIncludeConversation: options.canIncludeConversation,
    canGenerate:
      state.scopeKey === scopeKey &&
      target.rpcReady &&
      providerRead.state.status === "ready" &&
      (configured
        ? isExecutableTextModelSelection(providerRead.state.view, configured)
        : Boolean(options.selection?.options?.reasoningLevel)),
    unavailableReason: intl.formatMessage({
      id: target.rpcReady
        ? "chat.promptEnhancement.modelUnavailable"
        : "chat.promptEnhancement.connectionUnavailable",
    }),
    run,
    beforeSubmit,
    setIncludeConversation: useCallback(
      (value: boolean) => commit({ ...stateRef.current, includeConversation: value }),
      [commit],
    ),
    dismissFeedback: useCallback(
      () => commit({ ...stateRef.current, error: null, retained: null }),
      [commit],
    ),
  };
}

export type PromptEnhancementController = ReturnType<typeof usePromptEnhancement>;
