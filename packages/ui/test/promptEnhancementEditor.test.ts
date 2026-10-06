import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import {
  PromptMentionNode,
  $createPromptMentionNode,
} from "../src/mentions/nodes/PromptMentionNode.js";
import { $getPromptMarkdown } from "../src/mentions/promptSerialization.js";
import { createPromptEnhancementEditorApi } from "../src/prompt-editor/promptEnhancementEditor.js";

function setup() {
  const editor = createEditor({
    namespace: "enhancement-test",
    nodes: [PromptMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  const history = createEmptyHistoryState();
  const unregisterHistory = registerHistory(editor, history, 1000);
  const api = createPromptEnhancementEditorApi(editor, history);
  return {
    editor,
    api,
    history,
    dispose: () => {
      api.dispose();
      unregisterHistory();
    },
  };
}

function markdown(editor: ReturnType<typeof createEditor>): string {
  return editor.getEditorState().read(() => $getPromptMarkdown());
}

test("enhancement preserves mention payloads and exact code, and undo uses native history", async () => {
  const { editor, api, history, dispose } = setup();
  try {
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode("检查 "),
            $createPromptMentionNode({
              id: "file:a",
              category: "files",
              label: "a.ts",
              value: "a.ts",
              markdown: "[@a.ts](a.ts)",
              data: { path: "a.ts" },
            }),
            $createTextNode("\n```ts\nconst value = 'a  b';\n```"),
          ),
        );
      },
      { discrete: true },
    );
    const before = JSON.stringify(editor.getEditorState().toJSON());
    const prepared = api.prepare("test");
    assert.equal(prepared.protectedContent.length, 2);
    const record = api.apply(
      prepared,
      `请检查并解释 ${prepared.instruction.slice("检查 ".length)}`,
    );
    assert.ok(record);
    assert.ok(markdown(editor).includes("const value = 'a  b';"));
    const after = JSON.stringify(editor.getEditorState().toJSON());
    assert.ok(after.includes('"mentionId":"file:a"'));
    assert.ok(after.includes('"path":"a.ts"'));
    assert.equal(api.restore(record), true);
    await Promise.resolve();
    assert.equal(JSON.stringify(editor.getEditorState().toJSON()), before);
    assert.equal(history.redoStack.length, 1);
  } finally {
    dispose();
  }
});

test("editing and editing back invalidates a pending result, while selection changes do not", () => {
  const { editor, api, dispose } = setup();
  try {
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode("原稿")));
      },
      { discrete: true },
    );
    const prepared = api.prepare("test");
    editor.update(
      () => {
        $getRoot().getFirstChild()!.getFirstChild()!.setTextContent("改稿");
      },
      { discrete: true },
    );
    editor.update(
      () => {
        $getRoot().getFirstChild()!.getFirstChild()!.setTextContent("原稿");
      },
      { discrete: true },
    );
    assert.equal(api.apply(prepared, "增强稿"), null);
    const current = api.prepare("test");
    editor.update(
      () => {
        $getRoot().selectEnd();
      },
      { discrete: true },
    );
    assert.ok(api.apply(current, "有效增强稿"));
  } finally {
    dispose();
  }
});

test("missing protected references and stale undo never overwrite the current document", () => {
  const { editor, api, dispose } = setup();
  try {
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode("解释 `value`")));
      },
      { discrete: true },
    );
    const prepared = api.prepare("test");
    assert.throws(() => api.apply(prepared, "解释这段代码"), /protected/i);
    assert.equal(markdown(editor), "解释 `value`");
    const record = api.apply(prepared, `详细解释 ${prepared.protectedContent[0]!.token}`)!;
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("用户的新稿")));
      },
      { discrete: true },
    );
    assert.equal(api.restore(record), false);
    assert.equal(markdown(editor), "用户的新稿");
  } finally {
    dispose();
  }
});

test("a queued typing update is committed before checking whether a result can overwrite it", () => {
  const { editor, api, dispose } = setup();
  try {
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode("原稿")));
      },
      { discrete: true },
    );
    const prepared = api.prepare("test");
    editor.update(() => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode("刚刚输入的新稿")));
    });
    assert.equal(api.apply(prepared, "过期增强稿"), null);
    assert.equal(markdown(editor), "刚刚输入的新稿");
  } finally {
    dispose();
  }
});
