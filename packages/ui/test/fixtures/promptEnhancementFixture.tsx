import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { HistoryPlugin, createEmptyHistoryState } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { Emitter } from "@zcode/rpc";
import { validateBuiltinPrompt, type BuiltinPromptId } from "@zcode/shared/builtin-prompts";
import type { IServiceAccessor, ProviderSettingsView } from "@zcode/services";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { TabStoreProvider } from "@/store/TabStoreProvider.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ConfirmDialogHost } from "@/ConfirmDialog.js";
import { usePromptEnhancement } from "@/hooks/usePromptEnhancement.js";
import { createPromptEnhancementEditorApi } from "@/prompt-editor/promptEnhancementEditor.js";
import { PromptMentionNode } from "@/mentions/nodes/PromptMentionNode.js";
import { PromptEnhancementControls } from "@/v4/composer/PromptEnhancementControls.js";
import { PromptEnhancementFeedback } from "@/v4/composer/PromptEnhancementFeedback.js";
import { PromptEnhancementSection } from "@/settings/PromptEnhancementSection.js";
import { addPendingSettingsSectionListener } from "@/lib/settingsNavigation.js";
import "@/styles.css";

// 只模拟本次交互使用的 RPC；生产 hook、Lexical 历史、按钮和设置编辑器保持原样。
const selection = { providerId: "example", modelId: "current", options: { reasoningLevel: "low" } };
const changed = new Emitter<ProviderSettingsView>();
const broadcasts = new Emitter<{ channel: string; payload: null }>();
let view = {
  revision: 1,
  providers: [
    {
      providerId: "example",
      providerName: "Example",
      executable: true,
      models: ["current", "dedicated"].map((modelId) => ({
        modelId,
        selectable: true,
        defaultReasoningLevel: "low",
        effectiveConfig: { optionSpecs: { reasoningLevel: { values: ["low", "high"] } } },
      })),
    },
  ],
  promptEnhancementModelSelection:
    JSON.parse(localStorage.getItem("enhancement-model") ?? "null") ?? undefined,
} as unknown as ProviderSettingsView;
const requests: any[] = [];
const pending = new Map<
  string,
  { params: any; resolve(value: unknown): void; reject(error: Error): void }
>();
const cancelled: string[] = [];
const bridge: any = {
  requests,
  cancelled,
  finish() {
    const operation = [...pending.values()].at(-1)!;
    pending.delete(operation.params.operationId);
    operation.resolve({
      text: `${operation.params.request.mode}: ${operation.params.request.instruction}`,
      selection: operation.params.request.selection,
    });
  },
  fail() {
    const operation = [...pending.values()].at(-1)!;
    pending.delete(operation.params.operationId);
    operation.reject(new Error("model failed"));
  },
};
(window as any).promptEnhancementFixture = bridge;
const services = {
  providerSettingsService: {
    onDidChange: changed.event,
    getView: async () => view,
    savePromptEnhancementModelSelection: async (model: unknown) => {
      localStorage.setItem("enhancement-model", JSON.stringify(model));
      view = {
        ...view,
        revision: view.revision + 1,
        promptEnhancementModelSelection: model ?? undefined,
      } as ProviderSettingsView;
      changed.fire(view);
      return view;
    },
  },
  settingService: {
    getBuiltinPrompts: async () => JSON.parse(localStorage.getItem("enhancement-prompts") ?? "{}"),
    setBuiltinPrompt: async (id: BuiltinPromptId, text: string | null) => {
      if (text !== null) validateBuiltinPrompt(id, text);
      const prompts = JSON.parse(localStorage.getItem("enhancement-prompts") ?? "{}");
      if (text === null) delete prompts[id];
      else prompts[id] = text;
      localStorage.setItem("enhancement-prompts", JSON.stringify(prompts));
      return prompts;
    },
  },
  broadcastService: {
    onMessage: broadcasts.event,
    send: async (message: any) => {
      broadcasts.fire(message);
    },
  },
  zcodeAgentService: {
    enhancePrompt: (params: any) => {
      requests.push(params);
      return new Promise((resolve, reject) =>
        pending.set(params.operationId, { params, resolve, reject }),
      );
    },
    cancelPromptEnhancement: async (params: any) => {
      cancelled.push(params.operationId);
      return true;
    },
  },
} as unknown as IServiceAccessor;

function Editor({ inputApiRef, history, onChange }: any) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const enhancement = createPromptEnhancementEditorApi(editor, history);
    inputApiRef.current = { enhancement };
    bridge.setDraft = (text: string) =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append($createTextNode(text)));
        },
        { discrete: true },
      );
    const unregister = editor.registerUpdateListener(({ editorState }) =>
      editorState.read(() => onChange($getRoot().getTextContent())),
    );
    return () => {
      unregister();
      enhancement.dispose();
      inputApiRef.current = null;
    };
  }, [editor, history, inputApiRef, onChange]);
  return (
    <PlainTextPlugin
      contentEditable={<ContentEditable data-testid="enhancement-draft" aria-label="草稿" />}
      ErrorBoundary={LexicalErrorBoundary}
    />
  );
}

function Fixture() {
  const inputApiRef = useRef<LexicalChatInputHandle | null>(null);
  const [history] = useState(createEmptyHistoryState);
  const [text, setText] = useState("");
  const [scope, setScope] = useState("conversation-a");
  const [reference, setReference] = useState("reference-a");
  const [settingsMode, setSettingsMode] = useState<"organize" | "expand" | null>(null);
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  const controller = usePromptEnhancement({
    workspacePath: "/fixture",
    scopeId: scope,
    inputApiRef,
    selection,
    contextFingerprint: reference,
    readReferenceContext: () => reference,
    readConversationContext: () => "用户：沿用刚才的方案",
    canIncludeConversation: true,
  });
  useEffect(
    () =>
      addPendingSettingsSectionListener((_section, detail) =>
        setSettingsMode(detail?.promptEnhancementMode ?? "organize"),
      ),
    [],
  );
  return (
    <>
      <LexicalComposer
        initialConfig={{
          namespace: "enhancement-fixture",
          nodes: [PromptMentionNode],
          onError: (error) => {
            throw error;
          },
        }}
      >
        <Editor inputApiRef={inputApiRef} history={history} onChange={setText} />
        <HistoryPlugin externalHistoryState={history} />
      </LexicalComposer>
      <PromptEnhancementControls
        controller={controller}
        disabled={false}
        hasText={Boolean(text.trim())}
      />
      <button data-testid="enhancement-send" onClick={controller.beforeSubmit}>
        发送
      </button>
      <button
        data-testid="enhancement-change-reference"
        data-reference={reference}
        onClick={() => setReference("reference-b")}
      >
        替换引用
      </button>
      <button data-testid="enhancement-change-scope" onClick={() => setScope("conversation-b")}>
        切换会话
      </button>
      <PromptEnhancementFeedback controller={controller} />
      {settingsMode ? (
        <PromptEnhancementSection
          key={settingsMode}
          initialMode={settingsMode}
          navigationGuardRef={guard}
        />
      ) : null}
      <ConfirmDialogHost />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <ServiceProvider services={services}>
    <TabStoreProvider>
      <ZCodeIntlProvider initialLocale="zh-CN">
        <TooltipProvider>
          <Fixture />
        </TooltipProvider>
      </ZCodeIntlProvider>
    </TabStoreProvider>
  </ServiceProvider>,
);
