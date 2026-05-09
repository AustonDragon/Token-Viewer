import * as vscode from 'vscode';
import { TokenViewerSettings } from '../types';

export function getConfig(): TokenViewerSettings {
    const config = vscode.workspace.getConfiguration('tokenViewer');
    return {
        headers: config.get<Record<string, string>>('headers', {}),
        refreshInterval: config.get<number>('refreshInterval', 10),
        alertThreshold: config.get<number>('alertThreshold', 10000000),
        enableUsageNotification: config.get<boolean>('enableUsageNotification', true),
        notificationInterval: config.get<number>('notificationInterval', 30),
        showInStatusBar: config.get<boolean>('showInStatusBar', true),
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
