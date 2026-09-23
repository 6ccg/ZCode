import { useCallback, useEffect, useRef, useState } from "react";
import type { BuiltinPromptId, BuiltinPromptOverrides } from "@zcode/shared/builtin-prompts";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { logger } from "@/logger.js";

const CHANNEL = "settings:builtin-prompts-changed";

export function useBuiltinPrompts() {
  const { settingService, broadcastService } = useBaseWorkspaceServices();
  const [overrides, setOverrides] = useState<BuiltinPromptOverrides>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const settings = await settingService.getBuiltinPrompts();
      if (request !== generation.current) return;
      setOverrides(settings);
      setError(null);
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [settingService]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const subscription = broadcastService.onMessage((message) => {
      // 广播只失效视图，不再次写设置，避免跨窗口同步回环。
      if (message.channel === CHANNEL) void refresh();
    });
    return () => {
      generation.current++;
      subscription.dispose();
    };
  }, [refresh, broadcastService]);

  const save = useCallback(
    async (id: BuiltinPromptId, template: string | null) => {
      const result = await settingService.setBuiltinPrompt(id, template);
      // 保存响应比先前发起的读取更新，迟到的读取不能覆盖已提交结果。
      generation.current++;
      setOverrides(result);
      setError(null);
      try {
        await broadcastService.send({ channel: CHANNEL, payload: null });
      } catch (cause) {
        logger.warn("[builtinPrompts] 设置已保存，刷新其他窗口失败", cause);
      }
    },
    [settingService, broadcastService],
  );

  return { overrides, loading, error, refresh, save };
}
