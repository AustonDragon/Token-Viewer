import * as vscode from 'vscode';
import { XIAOMI_CONFIG } from './api/xiaomi';
import { initAlertState } from './services/alertService';
import { configureCookie } from './services/cookieService';
import { initTokenService, setupTimer, clearTimer, fetchTokenCount } from './services/tokenService';

export function activate(context: vscode.ExtensionContext): void {
    const { statusBarItem, outputChannel } = initTokenService(context, XIAOMI_CONFIG);

    initAlertState(context);

    const refreshCommand = vscode.commands.registerCommand(
        'tokenViewer.refresh',
        () => {
            outputChannel.appendLine('[Token Viewer] 手动触发刷新');
            fetchTokenCount(context);
        }
    );

    const configureCommand = vscode.commands.registerCommand(
        'tokenViewer.configure',
        () => configureCookie(context, XIAOMI_CONFIG, fetchTokenCount)
    );

    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tokenViewer')) {
            outputChannel.appendLine('[Token Viewer] 配置已变更，重新启动定时器');
            setupTimer(context);
            fetchTokenCount(context);
        }
    });

    context.subscriptions.push(statusBarItem, outputChannel, refreshCommand, configureCommand, configChangeListener);

    fetchTokenCount(context);
    setupTimer(context);
}

export function deactivate(): void {
    clearTimer();
}
