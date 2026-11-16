param([Parameter(Mandatory=$true)][string]$ArchivePath, [Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
# 使用系统 .NET 直接解压，既不加载外部 Archive 模块，也不经过 Electron 的 ASAR 文件系统包装。
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $Directory)
