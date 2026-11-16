import { isApiKeyAccess, normalizeModelLinkCatalog, type ProviderConfig } from "@zcode/provider";

/** 模型目录和实际模型请求共用用户配置的地址与 Key，不存在内置 ModelLink 服务端点。 */
export async function loadModelLinkCatalog(
  provider: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
) {
  const baseUrl = provider.api?.baseUrl?.trim();
  const apiKey = isApiKeyAccess(provider.access) ? provider.access.apiKey?.trim() : undefined;
  if (!baseUrl || !apiKey) throw new Error("请先填写并保存 Base URL 和 API Key");
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Base URL 必须是 HTTP 或 HTTPS 地址");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  // 显式申请目录扩展，让其他客户端继续收到原来的模型列表结构。
  url.searchParams.set("include", "modellink");
  const headers = new Headers(provider.api?.headers ?? {});
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ModelLink 模型目录请求失败（HTTP ${response.status}）`);
  return normalizeModelLinkCatalog(await response.json(), provider.api?.type ?? "");
}
