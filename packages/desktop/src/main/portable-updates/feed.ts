import semver from "semver";
import type { PortableRelease, PortableUpdaterOptions } from "./contract.js";

export function updateSourceUrl(source: string): string {
  const url = new URL(source);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("更新地址必须使用 HTTP 或 HTTPS");
  if (url.hostname === "github.com") {
    const [owner, repository, section, kind, ...tag] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repository || (section && section !== "releases"))
      throw new Error("请填写 GitHub 仓库或 Release 地址");
    return `https://api.github.com/repos/${owner}/${repository}/releases/${kind === "tag" && tag.length ? `tags/${encodeURIComponent(tag.join("/"))}` : "latest"}`;
  }
  return url.href;
}

async function readJson(
  url: string,
  options: PortableUpdaterOptions,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await options.fetch(updateSourceUrl(url), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok || !response.body) throw new Error(`更新地址返回 HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let content = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1_048_576) throw new Error("更新清单过大，请填写清单地址而不是安装包地址");
      content += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(content + decoder.decode()) as Record<string, unknown>;
  } finally {
    await reader.cancel();
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function resolveRelease(
  source: string,
  options: PortableUpdaterOptions,
  signal: AbortSignal,
): Promise<PortableRelease> {
  const value = await readJson(source, options, signal);
  let release: PortableRelease;
  if (typeof value.tag_name === "string") {
    if (value.draft || value.prerelease) throw new Error("更新源必须提供正式 Release");
    const [platform, arch] = options.target.split("-");
    const suffix = platform === "win32" ? `-win-${arch}-portable.zip` : `-mac-${arch}.zip`;
    const assets = Array.isArray(value.assets) ? value.assets.map(object) : [];
    const asset = assets.find(
      (entry) => typeof entry.name === "string" && entry.name.endsWith(suffix),
    );
    if (!asset) throw new Error(`Release 没有 ${options.target} 的绿色 ZIP`);
    let commit = String(value.target_commitish ?? "");
    if (!/^[a-f0-9]{7,40}$/i.test(commit)) {
      const metadata = assets.find((entry) => entry.name === "build-info.json");
      if (!metadata || typeof metadata.browser_download_url !== "string")
        throw new Error("Release 需要提供源码提交或 build-info.json");
      const info = await readJson(metadata.browser_download_url, options, signal);
      const build = Array.isArray(info.builds)
        ? info.builds.map(object).find((entry) => entry.target === options.target)
        : info;
      commit = String(build?.sourceCommit ?? "");
    }
    release = {
      version: value.tag_name.replace(/^v/, ""),
      sourceCommit: commit,
      publishedAt: String(value.published_at ?? ""),
      url: String(asset.browser_download_url ?? ""),
      sha256: String(asset.digest ?? "").replace(/^sha256:/, ""),
    };
  } else {
    const asset = object(object(value.assets)[options.target]);
    release = {
      version: String(value.version ?? "").replace(/^v/, ""),
      sourceCommit: String(value.sourceCommit ?? ""),
      publishedAt: String(value.publishedAt ?? ""),
      url: String(asset.url ?? ""),
      sha256: String(asset.sha256 ?? ""),
    };
  }
  if (
    !semver.valid(release.version) ||
    !/^[a-f0-9]{7,40}$/i.test(release.sourceCommit) ||
    !Number.isFinite(Date.parse(release.publishedAt))
  )
    throw new Error("更新清单缺少有效版本、源码提交或发布时间");
  if (!/^[a-f0-9]{64}$/i.test(release.sha256)) throw new Error("更新包必须提供 SHA-256 摘要");
  const archive = new URL(release.url);
  if (
    !["https:", "http:"].includes(archive.protocol) ||
    !archive.pathname.toLowerCase().endsWith(".zip")
  )
    throw new Error("更新源必须提供当前平台的绿色 ZIP");
  return { ...release, sha256: release.sha256.toLowerCase() };
}

export function isNewRelease(
  release: PortableRelease,
  current: PortableUpdaterOptions["current"],
): boolean {
  const commit = release.sourceCommit.toLowerCase();
  const installedCommit = current.commit.toLowerCase();
  if (
    installedCommit.length >= 7 &&
    (commit.startsWith(installedCommit) || installedCommit.startsWith(commit))
  )
    return false;
  const candidate = semver.parse(release.version)!;
  const installed = semver.parse(current.version);
  if (!installed) return false;
  const comparison = semver.compare(
    `${candidate.major}.${candidate.minor}.${candidate.patch}`,
    `${installed.major}.${installed.minor}.${installed.patch}`,
  );
  return (
    comparison > 0 ||
    (comparison === 0 && Date.parse(release.publishedAt) > Date.parse(current.buildTime))
  );
}
