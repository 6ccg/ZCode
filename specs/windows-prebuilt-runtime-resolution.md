# Windows 显式预打包运行时解析

`windowsCuaDevRuntime` 是 Windows helper 路径解析的唯一所有者，不启动程序、不改变 broker 连接或认证。

- 显式目录优先级：`ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR` > `ZCODE_CUA_DEV_ROOT` > 产品目录。忽略空白环境变量；非空高优先级输入无效时直接失败，不回退。
- 显式目录允许原有 `@zcode/zcode-cua` producer 契约，或 `@zcode/zcode-cua-helper-runtime` 预打包目录。
- 预打包目录必须有普通、根内的 package.json，type=module、main 与 manifest.entry 一致、version 与 manifest.packageVersion 一致。
- 预打包和产品目录共用严格 manifest 字段、路径、SHA-256、架构、Electron 版本及 PE machine 校验。预打包身份不跳过任何产品校验。
- Electron 版本必须相同。不同代表该组合未验证，不代表 Node-API 不兼容；不重写 manifest、不绕过策略。
- 返回 source 区分 development-source、development-prebuilt、packaged，避免把本地二进制包称为源码构建。
- 所有布局沿用 Electron Node helper host；不复制 native/addon，不在 Linux 执行 Windows 二进制。

验收：原有 producer 可用；真实预打包布局可解析；包身份/版本/main 不符、清单未知字段、哈希错误、PE 架构错误、路径穿越/符号链接和 Electron 版本不符均拒绝；显式错误不回退。

## 外部 Windows bridge 的启动边界

现有预打包 bridge 在 Windows 的 standalone 启动函数直接返回，不能依赖它解释 helper recipe。
仅在已启用 MCP 准备边界、Windows 且配置外部运行时目录时，由现有生命周期 owner acquire 托管 helper，
await host.start()，再次检查同一 owner 仍有效，然后交出 resolver。停止/禁用/替换造成 owner 失效时返回 undefined。
非 bridge（包括 legacy/native producer）保持 peek-only，不 acquire、不启动。
此适配不创建新 launcher、不解释 recipe、不改变本地工作区准入或认证；并发/幂等由现有生命周期与 host.start 所有。

```text
enabled MCP preparation → acquire existing owner → check owner → host.start()
                       → recheck owner → resolver or undefined
stop/disable/replacement ────────────────→ invalidates owner
```

准备与显式重启使用不同失败策略：selector 保留 start 的原始 rejection。动态 resolver 的
resolveMcpServers 准备边界记录诊断并仅移除 CUA candidates，保留其它 MCP 的顺序、对象与原配置，
避免一次 helper 冷启动失败中断无关会话。restart / restartAfterPermissionGrant 不吞掉此异常，
仍向显式操作调用方报告失败。
