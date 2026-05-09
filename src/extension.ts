import * as vscode from 'vscode';
import { XIAOMI_CONFIG } from './api/xiaomi';
import { initAlertState } from './services/alertService';
import { configureCookie } from './services/cookieService';
import { initTokenService, setupTimer, clearTimer, fetchTokenCount } from './services/tokenService';
import { openSettingsPanel } from './views/settingsPanel';

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

    const openSettingsCommand = vscode.commands.registerCommand(
        'tokenViewer.openSettings',
        () => openSettingsPanel(context)
    );

    const menuCommand = vscode.commands.registerCommand(
        'tokenViewer.menu',
        async () => {
            const items = [
                { label: '$(refresh) 刷新 Token', action: 'refresh' as const },
                { label: '$(settings-gear) 打开设置面板', action: 'settings' as const },
                { label: '$(key) 配置 Cookie', action: 'cookie' as const },
            ];
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Token Viewer' });
            if (!picked) { return; }
            switch (picked.action) {
                case 'refresh': vscode.commands.executeCommand('tokenViewer.refresh'); break;
                case 'settings': openSettingsPanel(context); break;
                case 'cookie': configureCookie(context, XIAOMI_CONFIG, fetchTokenCount); break;
            }
        }
    );

    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tokenViewer')) {
            outputChannel.appendLine('[Token Viewer] 配置已变更，重新启动定时器');
            setupTimer(context);
            fetchTokenCount(context);
        }
    });

    context.subscriptions.push(statusBarItem, outputChannel, refreshCommand, configureCommand, openSettingsCommand, menuCommand, configChangeListener);

    fetchTokenCount(context);
    setupTimer(context);
}

export function deactivate(): void {
    clearTimer();
}
