import * as vscode from 'vscode';
import { initAlertState } from './services/alertService';
import { configureCookie } from './services/cookieService';
import { startBrowserFetch, handleCallbackUri, CALLBACK_PATH } from './api/browserCallback';
import { initTokenService, setupTimer, clearTimer, fetchTokenCount } from './services/tokenService';
import { openSettingsPanel } from './views/settingsPanel';
import { resolvePlatformConfig, getConfig, migrateOldCookie } from './config/settings';

let uriHandler: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext): void {
    migrateOldCookie();

    const { statusBarItem, outputChannel } = initTokenService(context);

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
        () => {
            const config = getConfig();
            const platformConfig = resolvePlatformConfig(config.xiaomiPlanType);
            if (platformConfig) {
                configureCookie(context, platformConfig, fetchTokenCount);
            } else {
                vscode.window.showWarningMessage('当前计费模式暂不支持，请切换到 Token Plan (CN) 或 (SG)');
            }
        }
    );

    const fetchFromBrowserCommand = vscode.commands.registerCommand(
        'tokenViewer.fetchFromBrowser',
        async () => {
            const config = getConfig();
            const platformConfig = resolvePlatformConfig(config.xiaomiPlanType);
            if (!platformConfig) {
                vscode.window.showWarningMessage('当前计费模式暂不支持，请切换到 Token Plan (CN) 或 (SG)');
                return;
            }
            const apiBase = platformConfig.apiUrl.split('?')[0];
            await startBrowserFetch(context, apiBase);
        }
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
                { label: '$(browser) 从浏览器获取 Cookie', action: 'fetchBrowser' as const },
            ];
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Token Viewer' });
            if (!picked) { return; }
            switch (picked.action) {
                case 'refresh': vscode.commands.executeCommand('tokenViewer.refresh'); break;
                case 'settings': openSettingsPanel(context); break;
                case 'cookie': {
                    const cfg = getConfig();
                    const pc = resolvePlatformConfig(cfg.xiaomiPlanType);
                    if (pc) {
                        configureCookie(context, pc, fetchTokenCount);
                    } else {
                        vscode.window.showWarningMessage('当前计费模式暂不支持，请切换到 Token Plan (CN) 或 (SG)');
                    }
                    break;
                }
                case 'fetchBrowser': vscode.commands.executeCommand('tokenViewer.fetchFromBrowser'); break;
            }
        }
    );

    uriHandler = vscode.window.registerUriHandler({
        handleUri(uri: vscode.Uri) {
            if (uri.path === '/callback') {
                handleCallbackUri(context, uri, fetchTokenCount);
            }
        }
    });

    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tokenViewer')) {
            outputChannel.appendLine('[Token Viewer] 配置已变更，重新启动定时器');
            setupTimer(context);
            fetchTokenCount(context);
        }
    });

    context.subscriptions.push(statusBarItem, outputChannel, refreshCommand, configureCommand, fetchFromBrowserCommand, openSettingsCommand, menuCommand, uriHandler, configChangeListener);

    fetchTokenCount(context);
    setupTimer(context);
}

export function deactivate(): void {
    clearTimer();
}
