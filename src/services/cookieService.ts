import * as vscode from 'vscode';
import { PlatformConfig } from '../types';
import { getCurrentCookie } from '../config/settings';

export function isAuthError(message: string): boolean {
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes('http 401') || lowerMsg.includes('http 403')) {
        return true;
    }
    const authKeywords = [
        'unauthorized', 'forbidden', 'token expired', 'session expired',
        'cookie expired', 'login required', 'access denied', 'not authenticated',
        '未登录', '登录已过期', '认证失败', '请重新登录',
    ];
    return authKeywords.some(keyword => lowerMsg.includes(keyword));
}

export async function configureCookie(
    context: vscode.ExtensionContext,
    platformConfig: PlatformConfig,
    onRefresh: (ctx: vscode.ExtensionContext) => Promise<void>
): Promise<void> {
    const config = vscode.workspace.getConfiguration('tokenViewer');
    const currentCookie = config.get<string>('cookie', '');

    const cookieValue = await vscode.window.showInputBox({
        prompt: `请粘贴 Cookie\n\n` +
            `获取方法：\n` +
            `1. 浏览器打开 ${platformConfig.loginUrl}\n` +
            `2. 登录后按 F12 → Network → 找到请求 → Headers → 复制 ${platformConfig.headerKey} 的值`,
        placeHolder: `粘贴完整的 ${platformConfig.headerKey} 字符串...`,
        value: currentCookie,
        validateInput: (value) => {
            if (!value || value.trim() === '') { return `${platformConfig.headerKey} 不能为空`; }
            return null;
        },
    });

    if (cookieValue === undefined) {
        vscode.window.showInformationMessage('Token Viewer 配置已取消');
        return;
    }

    await config.update('cookie', cookieValue, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage('✅ Cookie 已保存，正在刷新...');

    await onRefresh(context);
}

let isRefreshingCookie: boolean = false;

export async function triggerCookieRefresh(
    context: vscode.ExtensionContext,
    platformConfig: PlatformConfig,
    onRefresh: (ctx: vscode.ExtensionContext) => Promise<void>
): Promise<void> {
    if (isRefreshingCookie) { return; }
    isRefreshingCookie = true;

    try {
        vscode.env.openExternal(vscode.Uri.parse(platformConfig.loginUrl));

        const action = await vscode.window.showWarningMessage(
            '⚠️ Cookie 已过期！\n\n' +
            '已打开登录页面，请在浏览器中登录后，复制新的 Cookie。\n' +
            '然后点击「更新 Cookie」按钮。',
            '更新 Cookie',
            '稍后再说'
        );

        if (action !== '更新 Cookie') { return; }

        const newCookie = await vscode.window.showInputBox({
            prompt: `请粘贴新的 Cookie\n\n获取方法：浏览器登录 → F12 → Network → Headers → 复制 ${platformConfig.headerKey}`,
            placeHolder: `粘贴新的 ${platformConfig.headerKey} 字符串...`,
            validateInput: (value) => {
                if (!value || value.trim() === '') { return `${platformConfig.headerKey} 不能为空`; }
                return null;
            },
        });

        if (newCookie === undefined) { return; }

        const vscodeConfig = vscode.workspace.getConfiguration('tokenViewer');
        await vscodeConfig.update('cookie', newCookie, vscode.ConfigurationTarget.Global);

        await onRefresh(context);
        vscode.window.showInformationMessage('✅ Cookie 已更新，Token 数据已刷新！');

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Cookie 更新失败: ${msg}`);
    } finally {
        isRefreshingCookie = false;
    }
}
