<p align="center">
  <img src="https://img.shields.io/badge/VSCode-Extension-blue?style=for-the-badge&logo=visual-studio-code" alt="VSCode Extension">
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License">
</p>

<h1 align="center">Token Viewer</h1>

<p align="center">
  VSCode 状态栏实时显示小米 MiMo 平台的剩余 Credits 额度<br>
  缩写显示 · 百分比 · 今日用量 · 按模型分拆报告 · Cookie 自动检测 · 浏览器自动登录
</p>

---

## 功能特性

- **Credits 实时监控** - 状态栏显示剩余 Credits 额度，使用 `1.2M`、`4.1B` 等紧凑格式
- **剩余百分比** - 同时显示额度剩余百分比（如 `4.1B (98.7%)`）
- **今日用量** - 鼠标悬停状态栏，查看当天各模型的 Token 用量、Credits 消耗和请求次数
- **按模型分拆报告** - 每 30 分钟弹出通知，显示各模型的 Token 消耗量
- **模型消耗比例** - tooltip 展示各模型的缓存/输入/输出 Credit 消耗比例
- **自动定时刷新** - 默认每 10 秒刷新，可自定义间隔
- **浏览器自动登录** - 一键启动 Chrome/Edge，自动打开登录页面，登录后自动提取 Cookie 并保存
- **HTTP 代理采集** - 内置代理服务器，浏览器通过代理访问平台，自动从请求中提取 Cookie
- **Cookie 持久化** - Cookie 保存在 globalState 中，配置丢失时自动恢复
- **Cookie 过期检测** - 连续 2 次认证失败后自动打开登录页面，引导更新 Cookie
- **系统代理绕过** - 请求平台 API 时自动绕过系统代理，避免代理干扰
- **告警通知** - Credits 低于阈值时状态栏变色并弹出警告
- **点击刷新** - 点击状态栏项立即刷新
- **跨会话保留** - 上次获取的额度在重启 VSCode 后仍然显示

## 模型消耗比例

各模型按不同比例消耗 Credits，TTS 系列免费：

| 模型 | 输入（命中缓存） | 输入（未命中缓存） | 输出 |
|------|:---:|:---:|:---:|
| MiMo-V2.5-Pro | 2.5 | 300 | 600 |
| MiMo-V2.5 | 2 | 100 | 200 |

> TTS 系列模型限时免费，不消耗 Credits。

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

### 方式一：浏览器自动获取（推荐）

1. 按 `Ctrl+Shift+P`，输入 `Token Viewer: 启动代理采集 Cookie`
2. 浏览器会自动打开小米平台登录页面
3. 登录小米账号后，插件自动提取并保存 Cookie

> 需要安装 [Puppeteer](https://pptr.dev/)：`npm install puppeteer-core`
> 支持 Chrome 和 Edge 浏览器

### 方式二：手动获取 Cookie

1. 浏览器打开 https://platform.xiaomimimo.com/console/plan-manage 并登录
2. 按 `F12` 打开开发者工具 → **Network** 标签页
3. 刷新页面，在请求列表中找到任意一个请求
4. 点击该请求，在 **Headers** 中找到 **Cookie** 字段
5. 复制 Cookie 的完整值
6. 按 `Ctrl+Shift+P`，输入 `Token Viewer: 配置 Cookie`，粘贴 Cookie

### 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `tokenViewer.headers` | 请求头，只需填 Cookie | `{}` |
| `tokenViewer.refreshInterval` | 刷新间隔（秒） | `10` |
| `tokenViewer.alertThreshold` | 告警阈值（Credits） | `100000000` |
| `tokenViewer.proxyPort` | 内置代理服务器端口 | `2888` |

## 命令

| 命令 | 说明 |
|------|------|
| `Token Viewer: 配置 Cookie` | 打开 Cookie 配置向导 |
| `Token Viewer: 刷新 Token 数量` | 立即刷新 |
| `Token Viewer: 启动代理采集 Cookie` | 启动内置 HTTP 代理，通过浏览器访问平台自动采集 Cookie |
| `Token Viewer: 停止代理` | 停止内置代理服务器 |
| `Token Viewer: 代理状态` | 查看代理服务器运行状态 |

## 常见问题

**状态栏显示 Error？**
按 `Ctrl+Shift+U` 打开输出面板，选择 **Token Viewer** 查看日志。通常是 Cookie 过期导致。

**Cookie 过期了？**
插件会自动检测并弹出提示，点击「更新 Cookie」即可。也可以手动运行 `Token Viewer: 配置 Cookie`。

**今日用量没有显示？**
确认 Cookie 有效且包含 `api-platform_ph` 参数。查看输出面板的日志，定位具体错误。

**用量报告什么时候弹出？**
每 30 分钟自动弹出一次通知，显示各模型的 Token 消耗量。

**浏览器自动登录失败？**
确保已安装 Puppeteer：`npm install puppeteer-core`。如果 Chrome/Edge 未安装在默认路径，请手动配置 Cookie。

## 开发

```bash
npm install          # 安装依赖
npm run compile      # 编译
npm run watch        # 监听模式
vsce package         # 打包 .vsix
```

## License

[MIT](LICENSE)
