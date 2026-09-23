# 官方套餐入口开关

## 产品规则

- 保留上游内置供应商、品牌目录下载/缓存、通用渠道及现有模型请求链路。
- 通过 `packages/ui/src/lib/officialPlanAvailability.ts` 中的 `ZHIPU_OFFICIAL_PLANS_ENABLED = false` 禁用智谱/Z.ai 官方套餐入口。恢复入口只改此常量。
- 两个 Coding Plan Key 模板不可创建；已有套餐详情不展示可填写表单；首次配置的套餐 Key 输入、保存及套餐购买入口禁用，并显示原因。
- 普通 Z.ai API、BigModel API、其他供应商和通用自定义渠道仍可用。判断依据是现有 `access.type`，不按显示名称、域名或模型名称猜测。
- 这是 UI 功能开关，不删除已有个人配置、凭据或后端能力。官方 Coding Plan URL 的上游网关转发规则保留；手动填写相同 URL 仍会按原规则转发。

## 所有者与边界

- UI 通过现有 `useModelProviders` 和设置服务访问渠道；ProviderConfigService/PersonalProviderConfigRepository 是唯一配置写入入口。
- 禁用入口在 UI 层停止，不提交创建/保存命令。普通渠道沿用模板选择器、InlineEditableProviderCard 与原有导航。
- 不改变 provider/model 身份、session、workspace identity、owner/lease 或桌面与手机的 stream 语义。

## 验收与验证

- Coding Plan 模板、首次配置表单、已有套餐详情和共享购买入口均禁用；普通 API 模板和通用渠道可创建、编辑、保存。
- `packages/ui/test/officialPlanAvailability.test.ts` 检查入口判定；`packages/provider-node/test/genericChannels.test.ts` 检查通用渠道生命周期。
- `apps/zcode-cli/packages/adapters/test/generic-model-transport.test.ts` 通过本地 HTTP 夹具检查官方 URL 转发、第三方 URL 保留及正文/认证头传递。
- 已在隔离 Web/Server 中通过上述入口和普通 Z.ai API 创建保存的界面检查；未把设置页检查视为完整桌面聊天或安装包验证。
