# 桌面构建期可选能力

## 目标

两项上报能力由构建期配置决定是否启用，未配置时关闭。

本项目的官方安装包更新器另外受产品策略固定停用。绿色版更新使用设置中的自定义地址，默认留空且关闭自动检查，不受官方更新构建开关控制，见[绿色版更新规格](../../specs/modified-desktop-updates.md)。

| 能力             | 配置项                            | 关闭时的行为                                                      |
| ---------------- | --------------------------------- | ----------------------------------------------------------------- |
| ARMS RUM 上报    | `ZCODE_ARMS_RUM_ENDPOINT`         | 主进程与渲染进程的 ARMS SDK 以 `enable: false` 初始化，不产生上报 |
| 事件上报（数仓） | `ZCODE_TELEMETRY_REPORT_ENDPOINT` | 遥测事件在发送前直接返回                                          |
| 官方安装包更新   | 产品策略固定关闭                  | 不检查、不下载官方更新                                            |

上报地址由构建配置提供，无需在源码中写死。绿色版更新偏好使用运行时系统设置。

## 配置来源与优先级

1. 构建进程的环境变量。显式设置为空字符串表示关闭。
2. `config/private/build-defaults.json`。只存在于内部仓库，开源导出不包含。
3. 以上都没有时关闭。

## 所有者与数据流

```
环境变量 / config/private/build-defaults.json
        │ scripts/build-time-config.mjs（唯一解析入口）
        ▼
desktop tsup（main、host、preload）与 desktop vite（renderer）的 define
        │ __ZCODE_ARMS_RUM_ENDPOINT__ / __ZCODE_TELEMETRY_REPORT_ENDPOINT__ / __ZCODE_AUTO_UPDATE_ENABLED__
        ▼
@zcode/shared env 常量 ── 运行时代码只读这些常量
```

- 未注入 define 的环境（测试、其他 bundle）得到关闭值；vitest 为测试注入固定的事件上报端点，以便验证上报链路。
- 官方更新还受 `ZCODE_APP_UPDATES_ENABLED` 固定关闭约束，不能通过 `ZCODE_AUTO_UPDATE` 恢复；绿色版更新由用户配置的地址和偏好控制。
- Agent 的 OTLP 遥测沿用既有机制，由打包环境的 `ZCODE_PACKAGED_AGENT_OTEL_*` 注入，不在本文件范围内。

## 验收

1. 显式提供上报端点时，对应能力可启用；官方更新保持关闭。
2. 没有私有默认配置、也没有环境变量时，上报关闭；绿色版更新地址默认空。
3. 环境变量优先于私有默认配置，显式空字符串可以关闭单项能力。
4. 类型检查、Lint 与对应工程/运行时验收通过。
