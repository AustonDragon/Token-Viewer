# Changelog

## [1.2.1] - 2026-05-10

### Refactor

- 拆分 `extension.ts` 为多模块结构，提升代码可维护性
  - 新增 `src/config/settings.ts` — 配置管理
  - 新增 `src/services/cookieService.ts` — Cookie 读取与校验
  - 新增 `src/services/tokenService.ts` — Token 数据拉取与解析
  - 新增 `src/services/alertService.ts` — 告警与通知服务
  - 新增 `src/utils/http.ts` — HTTP 请求封装
  - 新增 `src/utils/jsonPath.ts` — JSON 路径解析工具
  - 新增 `src/platforms/xiaomi.ts` — 小米平台适配
  - 新增 `src/types/index.ts` — 类型定义
- 简化 Cookie 存储为单一共享字段，修复所有类型不匹配问题

### Feat

- 新增设置面板 Webview，支持可视化配置
- 新增菜单快捷选择（QuickPick）
- 支持状态栏显隐切换
- 支持用量报告通知间隔配置
- 支持小米 MiMo 计费模式切换（CN / SG / Balance 占位）

## [1.2.0] - 2026-04-28

### Feat

- 状态栏数字缩写显示
- 半小时用量提醒
- 刷新间隔默认改为 10 秒

## [1.1.0] - 2026-04-25

### Feat

- 状态栏显示 Token 剩余百分比

## [1.0.0] - 2026-04-20

### Feat

- 精简为小米 MiMo 专用
- Cookie 过期自动检测 + 自动打开登录页
- 输入 URL 自动识别平台，只需粘贴 Cookie 即可完成配置
