import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";
import type { ProjectMemoryRetrievalBranch } from "../../memory/project-memory-retrieval-branch.js";
import { renderBuiltinPrompt, type BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";

export function buildMemorySection(
  memoryRoot: string | undefined,
  retrievalBranch: ProjectMemoryRetrievalBranch,
  overrides?: BuiltinPromptOverrides,
): ContextSection | null {
  if (!memoryRoot) return null;

  const content = renderBuiltinPrompt("main.memory", overrides, {
    memory_root: memoryRoot,
    memory_index_instructions:
      retrievalBranch === "default-index"
        ? "\n\nAfter writing the file, add a one-line pointer in `MEMORY.md` (`- [Title](file.md) — hook`). `MEMORY.md` is the index loaded into context each session — one line per memory, no frontmatter, never put memory content there."
        : "",
  });

  return {
    name: "Memory",
    source: "memory",
    injectionTarget: "system",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
