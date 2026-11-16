# Computer Use 组件桥接

此目录连接公共接口与随应用交付的私有运行时，提供 broker、帧契约、Host 生命周期和 workspace admission。

- 构建工具从具名 import/export 收集运行时依赖，按 `packages/zcode-cua` 的公共接口生成组件导出。
- Windows 原生进程由 `WindowsCuaHelperHost` 持有；客户端使用 Host authority 认证，SDK 在 factory 创建时捕获它。
- 私有运行时只在仓库外组装，随应用发布和更新。

构建与验证见 [组件规格](../../specs/bundled-computer-use.md)。桥接代码的版权及 MIT 许可见 [LICENSE](LICENSE)。
