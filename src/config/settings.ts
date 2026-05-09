import * as vscode from 'vscode';
import { XiaomiPlanType, TokenViewerSettings, PlatformConfig } from '../types';
import { getXiaomiPlanConfig, XIAOMI_LOGIN_URL, XIAOMI_HEADER_KEY } from '../platforms/xiaomi';

export function getConfig(): TokenViewerSettings {
    const config = vscode.workspace.getConfiguration('tokenViewer');
    const headers = config.get<Record<string, string>>('headers', {});
    const cookie = config.get<string>('cookie', '');
    const xiaomiPlanType = config.get<XiaomiPlanType>('xiaomiPlanType', 'cn');

    return {
        headers,
        cookie,
        refreshInterval: config.get<number>('refreshInterval', 10),
        alertThreshold: config.get<number>('alertThreshold', 10000000),
        enableUsageNotification: config.get<boolean>('enableUsageNotification', true),
        notificationInterval: config.get<number>('notificationInterval', 30),
        showInStatusBar: config.get<boolean>('showInStatusBar', true),
        xiaomiPlanType,
    };
}

export function getCurrentCookie(settings: TokenViewerSettings): string {
    if (settings.cookie) {
        return settings.cookie;
    }
    return settings.headers['Cookie'] || settings.headers['cookie'] || '';
}

export async function migrateOldCookie(): Promise<void> {
    const config = vscode.workspace.getConfiguration('tokenViewer');
    const headers = config.get<Record<string, string>>('headers', {});
    const cookie = config.get<string>('cookie', '');
    const oldCookie = headers['Cookie'] || headers['cookie'] || '';

    if (oldCookie && !cookie) {
        await config.update('cookie', oldCookie, vscode.ConfigurationTarget.Global);
        await config.update('headers', {}, vscode.ConfigurationTarget.Global);
    }
}

export function resolvePlatformConfig(planType: XiaomiPlanType): PlatformConfig | undefined {
    const plan = getXiaomiPlanConfig(planType);
    if (!plan || plan.disabled) { return undefined; }
    return {
        apiUrl: plan.apiUrl,
        jsonPath: plan.jsonPath,
        totalPath: plan.totalPath,
        usedPath: plan.usedPath,
        loginUrl: XIAOMI_LOGIN_URL,
        headerKey: XIAOMI_HEADER_KEY,
    };
}

export function formatCompact(num: number): string {
    const abs = Math.abs(num);
    if (abs >= 1e12) { return (num / 1e12).toFixed(1).replace(/\.0$/, '') + 'T'; }
    if (abs >= 1e9) { return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; }
    if (abs >= 1e6) { return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; }
    if (abs >= 1e4) { return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; }
    return num.toLocaleString('zh-CN');
}
