# 内置默认配置

`config/default.json` 是随客户端发布的默认配置，必须保留。Desktop 从打包文件读取，
Web 在构建时导入；远端请求失败或缺少有效字段时使用内置值。

## 帮助配置来源

新版社群和反馈入口请求当前 endpoint 的 `GET /api/v1/client/configs`，
读取 `data.configs.feedbackUrl`：

- `community_urls["zh-CN" | "en-US"]`：只按当前语言回退到内置入口，不跨语言回退。
- `feedback_url`：远端有效地址优先，否则使用内置地址。
- `feedback_use_external_form`：远端布尔值优先，`false` 也是有效覆盖。

请求携带 `app_version`；Desktop 另带 `platform-arch`，Web 省略平台参数。
成功响应仅做 1 小时内存缓存，请求使用 `cache: no-store`，失败不缓存。

```text
当前 endpoint client/configs -> 有效帮助字段 -> 平台入口
                  | 缺失 / 失败
                  v
          内置 default.json -> 平台入口
```

default.json 为随客户端分发的内置默认配置；历史上曾经 CDN 分发、仅为旧版客户端兼容保留，
现版本无请求或 URL 构造链路，只依赖本目录内置文件，其他字段与既有消费者保持不变。

详细规则见 [用户社群入口配置](../docs/ui/settings-community-link-config.md)。

## ModelLink 默认地址

构建 Desktop 或 Web 前，通过环境变量或根目录未跟踪的 `.env.local` 设置 `ZCODE_MODELLINK_BASE_URL`（填写完整 Base URL，通常含 `/v1`）。两端使用相同变量；仓库不提供实际 ModelLink 地址。

它只预填新建的 ModelLink Chat / Responses 渠道，未设置则留空；用户可以修改，已有渠道不受影响。API Key 仍在界面填写，不通过此变量注入。改变构建变量后需要重新构建，它不会在已安装应用中动态更新。

`ZCODE_BASE_URL` 仍表示 ZCode 控制面/官方网关地址，与 ModelLink 地址独立。
