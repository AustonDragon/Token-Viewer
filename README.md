<p align="center">
  <img src="https://img.shields.io/badge/VSCode-Extension-blue?style=for-the-badge&logo=visual-studio-code" alt="VSCode Extension">
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License">
</p>

<h1 align="center">Token Viewer</h1>

<p align="center">
  VSCode 状态栏实时显示小米 MiMo 平台的剩余 Token 数量<br>
  缩写显示 · 百分比 · 用量报告 · Cookie 过期自动检测
</p>

---

## 功能特性

- **状态栏缩写显示** - 用 `1.2M`、`500K` 等紧凑格式显示，节省状态栏空间
- **剩余百分比** - 同时显示 Token 剩余百分比（如 `1.2M (45.2%)`）
- **用量报告** - 每 30 分钟弹出通知，显示消耗量和剩余量
- **自动定时刷新** - 默认每 10 秒刷新，可自定义间隔
- **Cookie 过期检测** - 连续 2 次认证失败后自动打开登录页面，引导更新 Cookie
- **告警通知** - Token 低于阈值时状态栏变色并弹出警告
- **点击刷新** - 点击状态栏项立即刷新
- **跨会话保留** - 上次获取的 Token 数量在重启 VSCode 后仍然显示

## 安装

### 从 Releases 安装（推荐）

1. 从 [Releases](https://github.com/Bynlk/Token-Viewer/releases) 下载最新的 `.vsix` 文件
2. VSCode 中按 `Ctrl+Shift+P`，输入 `Extensions: Install from VSIX...`
3. 选择下载的 `.vsix` 文件

### 从源码构建

```bash
git clone https://github.com/Bynlk/Token-Viewer.git
cd Token-Viewer
npm install
npm run compile
vsce package
```

## 配置

安装后只需配置一个东西：**Cookie**。

### 快速配置

1. 按 `Ctrl+Shift+P`，输入 `Token Viewer: 配置 Cookie`
2. 粘贴你的 Cookie，完成

### 如何获取 Cookie

1. 浏览器打开 https://platform.xiaomimimo.com/console/plan-manage 并登录
2. 按 `F12` 打开开发者工具 → **Network** 标签页
3. 刷新页面，在请求列表中找到任意一个请求
4. 点击该请求，在 **Headers** 中找到 **Cookie** 字段
5. 复制 Cookie 的完整值

> **提示**：可以把开发者工具截图发给 AI（ChatGPT、Claude 等），让 AI 帮你找到 Cookie。

### 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `tokenViewer.headers` | 请求头，只需填 Cookie | `{}` |
| `tokenViewer.refreshInterval` | 刷新间隔（秒） | `10` |
| `tokenViewer.alertThreshold` | 告警阈值 | `10000000` |

## 命令

| 命令 | 说明 |
|------|------|
| `Token Viewer: 配置 Cookie` | 打开 Cookie 配置向导 |
| `Token Viewer: 刷新 Token 数量` | 立即刷新 |

## 常见问题

**状态栏显示 Error？**
按 `Ctrl+Shift+U` 打开输出面板，选择 **Token Viewer** 查看日志。通常是 Cookie 过期导致。

**Cookie 过期了？**
插件会自动检测并弹出提示，点击「更新 Cookie」即可。也可以手动运行 `Token Viewer: 配置 Cookie`。

**用量报告什么时候弹出？**
每 30 分钟自动弹出一次通知，显示这段时间内的 Token 消耗量和剩余量。

## 开发

```bash
npm install          # 安装依赖
npm run compile      # 编译
npm run watch        # 监听模式
vsce package         # 打包 .vsix
```

## License

[MIT](LICENSE)
