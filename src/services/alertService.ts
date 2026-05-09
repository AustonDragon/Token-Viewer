import * as vscode from 'vscode';
import { formatCompact } from '../config/settings';

let lastNotifyTime: number | undefined;
let lastNotifyToken: number | undefined;
let alertShown: boolean = false;

export function initAlertState(context: vscode.ExtensionContext): void {
    lastNotifyTime = context.globalState.get<number>('tokenViewer.lastNotifyTime');
    lastNotifyToken = context.globalState.get<number>('tokenViewer.lastNotifyToken');
}

export function handleUsageNotification(
    context: vscode.ExtensionContext,
    tokenNum: number,
    notificationInterval: number
): void {
    const nowMs = Date.now();
    const NOTIFY_INTERVAL = notificationInterval * 60 * 1000;

    if (lastNotifyTime !== undefined && lastNotifyToken !== undefined && (nowMs - lastNotifyTime) >= NOTIFY_INTERVAL) {
        const usedAmount = lastNotifyToken - tokenNum;
        if (usedAmount > 0) {
            const elapsed = Math.round((nowMs - lastNotifyTime) / 60000);
            const usedCompact = formatCompact(usedAmount);
            const currentCompact = formatCompact(tokenNum);
            vscode.window.showInformationMessage(
                `🤖 Token ${elapsed}分钟用量报告\n 📉消耗: ${usedCompact}\n 💰剩余: ${currentCompact}`
            );
        }
        lastNotifyTime = nowMs;
        lastNotifyToken = tokenNum;
        context.globalState.update('tokenViewer.lastNotifyTime', nowMs);
        context.globalState.update('tokenViewer.lastNotifyToken', tokenNum);
    } else if (lastNotifyTime === undefined) {
        lastNotifyTime = nowMs;
        lastNotifyToken = tokenNum;
        context.globalState.update('tokenViewer.lastNotifyTime', nowMs);
        context.globalState.update('tokenViewer.lastNotifyToken', tokenNum);
    }
}

export function checkAlertThreshold(
    statusBarItem: vscode.StatusBarItem,
    tokenNum: number,
    percentStr: string,
    alertThreshold: number,
    fullFormatted: string
): void {
    if (tokenNum <= alertThreshold) {
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        if (!alertShown) {
            alertShown = true;
            vscode.window.showWarningMessage(
                `⚠️ Token 不足！当前剩余: ${fullFormatted}${percentStr}，阈值: ${alertThreshold.toLocaleString('zh-CN')}`
            );
        }
    } else {
        statusBarItem.backgroundColor = undefined;
        alertShown = false;
    }
}
