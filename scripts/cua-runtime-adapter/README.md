# 当前官方 CUA 的 Windows 桥接

此目录由本项目维护，参考 ZcodePro 的 MIT 桥接思路，许可证见 LICENSE。

- 构建直接提取与工程版本对应的官方 SDK/helper，不读取旧补丁仓库、vendor 或安装器。
- 这些文件只提供公共接口、Host 生命周期/admission、broker 和帧契约；闭源实现仅在仓库外生成。
- 导出依赖由这里的具名 import/export 自动收集；bundler 前导来自当前官方产物。
- Windows 原生进程继续由既有 WindowsCuaHelperHost 持有。认证复用 Host authority；SDK 在 factory 时捕获它。
- CUA 无独立升级或首次下载；组件只随整个应用更新。
