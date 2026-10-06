import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
  UNDO_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import type { HistoryState } from "@lexical/react/LexicalHistoryPlugin";
import {
  restorePromptEnhancementContent,
  type PromptEnhancementProtectedContent,
} from "@zcode/shared";
import { $isPromptMentionNode, PromptMentionNode } from "@/mentions/nodes/PromptMentionNode.js";

type MentionJson = ReturnType<PromptMentionNode["exportJSON"]>;

export interface PreparedPromptEnhancement {
  instruction: string;
  protectedContent: PromptEnhancementProtectedContent[];
  beforeStateJson: string;
  revision: number;
  mentions: ReadonlyMap<string, MentionJson>;
}

export interface AppliedPromptEnhancement {
  beforeStateJson: string;
  afterStateJson: string;
  revision: number;
}

export interface PromptEnhancementEditorApi {
  prepare(nonce?: string): PreparedPromptEnhancement;
  isCurrent(prepared: PreparedPromptEnhancement): boolean;
  apply(prepared: PreparedPromptEnhancement, text: string): AppliedPromptEnhancement | null;
  restore(record: AppliedPromptEnhancement): boolean;
  subscribe(listener: () => void): () => void;
  isComposing(): boolean;
  dispose(): void;
}

const PROTECTED_CODE_PATTERN = /```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~|`[^`\n]+`/g;
const PROGRAMMATIC_UPDATE_TAG = "programmatic-update";

/** 使用 Lexical 的文档与历史作为唯一编辑事实，不访问编辑器私有 DOM。 */
export function createPromptEnhancementEditorApi(
  editor: LexicalEditor,
  history: HistoryState,
): PromptEnhancementEditorApi {
  let revision = 0;
  let trackedJson: string | null = null;
  const listeners = new Set<() => void>();
  // getEditorState 可能尚未包含本轮排队输入；先同步提交 pending 更新，再检查版本。
  const serialize = () => editor.read(() => JSON.stringify(editor.getEditorState().toJSON()));
  const isCurrent = (prepared: PreparedPromptEnhancement) => {
    const current = serialize();
    return (
      editor.isEditable() &&
      !editor.isComposing() &&
      revision === prepared.revision &&
      current === prepared.beforeStateJson
    );
  };
  const unregister = editor.registerUpdateListener(
    ({ editorState, dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      if (trackedJson === null && listeners.size === 0) {
        revision += 1;
        return;
      }
      const next = JSON.stringify(editorState.toJSON());
      if (trackedJson === next) return;
      trackedJson = next;
      revision += 1;
      for (const listener of listeners) listener();
    },
  );

  return {
    prepare(nonce = crypto.randomUUID()) {
      const beforeStateJson = serialize();
      const protectedContent: PromptEnhancementProtectedContent[] = [];
      const mentions = new Map<string, MentionJson>();
      const tokenPrefix = `[[ZCODE_KEEP_${nonce}_`;
      const protect = (content: string) => {
        const token = `${tokenPrefix}${protectedContent.length}]]`;
        protectedContent.push({ token, content });
        return token;
      };
      const serializeNode = (node: LexicalNode): string => {
        if ($isPromptMentionNode(node)) {
          const token = protect(node.getMarkdown());
          mentions.set(token, node.exportJSON());
          return token;
        }
        if (!$isElementNode(node)) return node.getTextContent();
        const children = node.getChildren();
        return children
          .map(
            (child, index) =>
              serializeNode(child) +
              ($isElementNode(child) && !child.isInline() && index < children.length - 1
                ? "\n\n"
                : ""),
          )
          .join("");
      };
      const raw = editor.getEditorState().read(() => serializeNode($getRoot()));
      const instruction = raw.replace(PROTECTED_CODE_PATTERN, (code) =>
        // 引用节点已经有独立占位符，不能把它再包进另一个受保护片段。
        code.includes(tokenPrefix) ? code : protect(code),
      );
      return { instruction, protectedContent, beforeStateJson, revision, mentions };
    },
    isCurrent,
    apply(prepared, text) {
      if (!isCurrent(prepared)) return null;
      restorePromptEnhancementContent(text, prepared.protectedContent);
      const entries = new Map(
        prepared.protectedContent.map((entry) => [entry.token, entry.content]),
      );
      const pattern = entries.size
        ? new RegExp([...entries.keys()].map(escapeRegExp).join("|"), "g")
        : null;
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          for (const line of text.split("\n\n")) {
            const paragraph = $createParagraphNode();
            let cursor = 0;
            if (pattern) {
              for (const match of line.matchAll(pattern)) {
                if (match.index > cursor)
                  paragraph.append($createTextNode(line.slice(cursor, match.index)));
                const mention = prepared.mentions.get(match[0]);
                paragraph.append(
                  mention
                    ? PromptMentionNode.importJSON(mention)
                    : $createTextNode(entries.get(match[0])!),
                );
                cursor = match.index + match[0].length;
              }
            }
            if (cursor < line.length || paragraph.getChildrenSize() === 0)
              paragraph.append($createTextNode(line.slice(cursor)));
            root.append(paragraph);
          }
        },
        {
          discrete: true,
          tag: [PROGRAMMATIC_UPDATE_TAG, HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG],
        },
      );
      return { beforeStateJson: prepared.beforeStateJson, afterStateJson: serialize(), revision };
    },
    restore(record) {
      const current = serialize();
      const previous = history.undoStack.at(-1);
      if (
        editor.isComposing() ||
        revision !== record.revision ||
        current !== record.afterStateJson ||
        previous?.editor !== editor ||
        JSON.stringify(previous.editorState.toJSON()) !== record.beforeStateJson
      )
        return false;
      return editor.dispatchCommand(UNDO_COMMAND, undefined);
    },
    subscribe(listener) {
      trackedJson = serialize();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) trackedJson = null;
      };
    },
    isComposing: () => editor.isComposing(),
    dispose() {
      unregister();
      listeners.clear();
      trackedJson = null;
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
