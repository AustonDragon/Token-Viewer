import * as vscode from 'vscode';
import { getConfig, formatCompact, resolvePlatformConfig, getCurrentCookie } from '../config/settings';
import { resolveJsonPath } from '../utils/jsonPath';
import { httpGet } from '../utils/http';
import { isAuthError, triggerCookieRefresh } from './cookieService';
import { handleUsageNotification, checkAlertThreshold } from './alertService';
import { getXiaomiPlanConfig } from '../platforms/xiaomi';

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let refreshTimer: NodeJS.Timeout | undefined;
let lastTokenCount: number | undefined;
let cookieErrorCount: number = 0;

export function initTokenService(
    ctx: vscode.ExtensionContext
): { statusBarItem: vscode.StatusBarItem; outputChannel: vscode.OutputChannel } {
    outputChannel = vscode.window.createOutputChannel('Token Viewer');
    outputChannel.appendLine('[Token Viewer] 插件已激活（小米 MiMo Token 监控）');

    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(sync~spin) Token: 加载中...';
    statusBarItem.tooltip = 'Token Viewer - 点击打开菜单';
    statusBarItem.command = 'tokenViewer.menu';
    statusBarItem.show();

    lastTokenCount = ctx.globalState.get<number>('tokenViewer.lastTokenCount');

    return { statusBarItem, outputChannel };
}

export function setupTimer(ctx: vscode.ExtensionContext): void {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }

    const config = getConfig();
    const platformConfig = resolvePlatformConfig(config.xiaomiPlanType);
    if (!platformConfig) {
        const plan = getXiaomiPlanConfig(config.xiaomiPlanType);
        if (plan?.disabled) {
            statusBarItem.text = '$(info) Balance 即将支持';
            statusBarItem.tooltip = 'Token Viewer - 该计费模式即将支持';
        }
        outputChannel.appendLine(`[Token Viewer] 当前计费模式不可用，定时器未启动`);
        return;
    }

    const intervalMs = config.refreshInterval * 1000;

    if (intervalMs > 0) {
        refreshTimer = setInterval(() => {
            fetchTokenCount(ctx);
        }, intervalMs);
        outputChannel.appendLine(`[Token Viewer] 定时器已启动，间隔 ${config.refreshInterval} 秒`);
    }
}

export function clearTimer(): void {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
}

export async function fetchTokenCount(context: vscode.ExtensionContext): Promise<void> {
    const config = getConfig();
    const platformConfig = resolvePlatformConfig(config.xiaomiPlanType);

    if (!platformConfig) {
        const plan = getXiaomiPlanConfig(config.xiaomiPlanType);
        if (plan?.disabled) {
            statusBarItem.text = '$(info) Balance 即将支持';
            statusBarItem.tooltip = 'Token Viewer - 该计费模式即将支持';
        }
        return;
    }

    const cookie = getCurrentCookie(config);
    if (!cookie) {
        statusBarItem.text = '$(warning) Token: 未配置';
        statusBarItem.tooltip = '请点击状态栏 → Token Viewer: 配置 Cookie';
        outputChannel.appendLine(`[Token Viewer] 警告：未配置 Cookie，请运行 Token Viewer: 配置 Cookie`);
        return;
    }

    try {
        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Cookie': cookie,
        };

        outputChannel.appendLine(`[Token Viewer] 正在请求: ${platformConfig.apiUrl}`);

        const responseBody = await httpGet(platformConfig.apiUrl, headers);

        let jsonData: any;
        try {
            jsonData = JSON.parse(responseBody);
        } catch (parseError) {
            const errorMsg = `JSON 解析失败: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
            handleFetchError(errorMsg, `响应内容: ${responseBody.substring(0, 500)}`);
            return;
        }

        const tokenCount = resolveJsonPath(jsonData, platformConfig.jsonPath);

        if (tokenCount === undefined || tokenCount === null) {
            handleFetchError(
                `无法按路径 "${platformConfig.jsonPath}" 解析 Token 数量`,
                `JSON 结构: ${JSON.stringify(jsonData).substring(0, 500)}`
            );
            return;
        }

        const tokenNum = Number(tokenCount);
        if (isNaN(tokenNum)) {
            handleFetchError(
                `路径 "${platformConfig.jsonPath}" 的值不是有效数字: ${tokenCount}`,
                `JSON 结构: ${JSON.stringify(jsonData).substring(0, 500)}`
            );
            return;
        }

        let percentage: number | undefined;
        let totalTokens: number | undefined;
        const totalVal = resolveJsonPath(jsonData, platformConfig.totalPath);
        const usedVal = resolveJsonPath(jsonData, platformConfig.usedPath);
        if (totalVal !== undefined && totalVal !== null) {
            totalTokens = Number(totalVal);
            if (!isNaN(totalTokens) && totalTokens > 0) {
                if (usedVal !== undefined && usedVal !== null) {
                    const usedNum = Number(usedVal);
                    if (!isNaN(usedNum)) {
                        percentage = ((totalTokens - usedNum) / totalTokens) * 100;
                    }
                } else {
                    percentage = (tokenNum / totalTokens) * 100;
                }
            }
        }

        cookieErrorCount = 0;
        lastTokenCount = tokenNum;
        context.globalState.update('tokenViewer.lastTokenCount', tokenNum);

        if (config.enableUsageNotification) {
            handleUsageNotification(context, tokenNum, config.notificationInterval);
        }

        if (config.showInStatusBar) {
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }

        const compact = formatCompact(tokenNum);
        const fullFormatted = tokenNum.toLocaleString('zh-CN');
        const percentStr = percentage !== undefined ? ` (${percentage.toFixed(1)}%)` : '';
        statusBarItem.text = `$(robot) ${fullFormatted}${percentStr}`;
        const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        let tooltipText = `Token Viewer - 小米 MiMo\n当前剩余: ${fullFormatted}（${compact}）`;
        if (percentage !== undefined) {
            tooltipText += `\n剩余百分比: ${percentage.toFixed(1)}%`;
        }
        if (totalTokens !== undefined) {
            tooltipText += `\n总量: ${totalTokens.toLocaleString('zh-CN')}（${formatCompact(totalTokens)}）`;
        }
        tooltipText += `\n最后更新: ${now}\n点击打开菜单`;
        statusBarItem.tooltip = tooltipText;

        checkAlertThreshold(statusBarItem, tokenNum, percentStr, config.alertThreshold, fullFormatted);

        outputChannel.appendLine(`[Token Viewer] ✅ Token 数量: ${fullFormatted}${percentStr}`);

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (isAuthError(errorMsg)) {
            cookieErrorCount++;
            outputChannel.appendLine(`[Token Viewer] 🔔 认证错误 (第 ${cookieErrorCount} 次): ${errorMsg}`);

            if (cookieErrorCount >= 2) {
                cookieErrorCount = 0;
                await triggerCookieRefresh(context, platformConfig, fetchTokenCount);
            } else {
                handleFetchError(errorMsg, 'Cookie 可能已过期，连续失败 2 次后将自动打开登录页面');
            }
        } else {
            handleFetchError(errorMsg, undefined);
        }
    }
}

function handleFetchError(message: string, detail?: string): void {
    if (lastTokenCount !== undefined) {
        const compact = lastTokenCount.toLocaleString('zh-CN');
        const formatted = lastTokenCount.toLocaleString('zh-CN');
        statusBarItem.text = `$(warning) ${compact} ⚠`;
        statusBarItem.tooltip = `Token Viewer - 请求失败\n${message}\n保留上次的值: ${formatted}`;
    } else {
        statusBarItem.text = '$(error) Token: Error';
        statusBarItem.tooltip = `Token Viewer - 请求失败\n${message}`;
    }

    outputChannel.appendLine(`[Token Viewer] 错误: ${message}`);
    if (detail) {
        outputChannel.appendLine(`[Token Viewer] 详情: ${detail}`);
    }
    outputChannel.appendLine('');
}
