import * as vscode from 'vscode';
import { XIAOMI_PLANS, XIAOMI_LOGIN_URL, XiaomiPlanConfig } from '../platforms/xiaomi';
import { XiaomiPlanType } from '../types';

let panel: vscode.WebviewPanel | undefined;

export function openSettingsPanel(context: vscode.ExtensionContext): void {
    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'tokenViewerSettings',
        'Token Viewer 设置',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getSettingsHtml(context);

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.type) {
            case 'save': {
                const config = vscode.workspace.getConfiguration('tokenViewer');
                await config.update('headers', { Cookie: message.cookie }, vscode.ConfigurationTarget.Global);
                await config.update('xiaomiPlanType', message.xiaomiPlanType, vscode.ConfigurationTarget.Global);
                await config.update('refreshInterval', message.refreshInterval, vscode.ConfigurationTarget.Global);
                await config.update('alertThreshold', message.alertThreshold, vscode.ConfigurationTarget.Global);
                await config.update('enableUsageNotification', message.enableUsageNotification, vscode.ConfigurationTarget.Global);
                await config.update('notificationInterval', message.notificationInterval, vscode.ConfigurationTarget.Global);
                await config.update('showInStatusBar', message.showInStatusBar, vscode.ConfigurationTarget.Global);
                vscode.commands.executeCommand('tokenViewer.refresh');
                vscode.commands.executeCommand('tokenViewer.refresh');
                panel?.webview.postMessage({ type: 'saved' });
                vscode.window.showInformationMessage('Token Viewer 设置已保存');
                break;
            }
            case 'getLoginUrl': {
                const plan = XIAOMI_PLANS.find(p => p.id === message.planId);
                panel?.webview.postMessage({ type: 'loginUrlData', url: plan ? XIAOMI_LOGIN_URL : '' });
                break;
            }
        }
    });

    panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
}

function getSettingsHtml(context: vscode.ExtensionContext): string {
    const config = vscode.workspace.getConfiguration('tokenViewer');
    const headers = config.get<Record<string, string>>('headers', {});
    const cookie = headers['Cookie'] || '';
    const xiaomiPlanType = config.get<XiaomiPlanType>('xiaomiPlanType', 'cn');
    const refreshInterval = config.get<number>('refreshInterval', 10);
    const alertThreshold = config.get<number>('alertThreshold', 10000000);
    const enableUsageNotification = config.get<boolean>('enableUsageNotification', true);
    const notificationInterval = config.get<number>('notificationInterval', 30);
    const showInStatusBar = config.get<boolean>('showInStatusBar', true);

    const planRadios = XIAOMI_PLANS.map(plan => {
        const checked = plan.id === xiaomiPlanType ? 'checked' : '';
        const disabled = plan.disabled ? 'disabled' : '';
        const disabledHint = plan.disabled ? ' <span style="color:var(--description-fg);font-size:11px;">（即将支持）</span>' : '';
        return `<div class="radio-item">
            <input type="radio" name="planType" id="plan-${plan.id}" value="${plan.id}" ${checked} ${disabled}>
            <label for="plan-${plan.id}">${plan.name}${disabledHint}</label>
        </div>`;
    }).join('\n');

    return /*html*/ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Token Viewer 设置</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-foreground);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border, #3c3c3c);
            --input-fg: var(--vscode-input-foreground);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --link-fg: var(--vscode-textLink-foreground);
            --description-fg: var(--vscode-descriptionForeground);
            --section-border: var(--vscode-widget-border, #3c3c3c);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--fg);
            background: var(--bg);
            padding: 24px 32px;
            line-height: 1.6;
        }

        h1 {
            font-size: 22px;
            font-weight: 600;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .subtitle {
            color: var(--description-fg);
            margin-bottom: 28px;
            font-size: 13px;
        }

        .section { margin-bottom: 28px; }

        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--section-border);
        }

        .form-group { margin-bottom: 16px; }
        .form-group:last-child { margin-bottom: 0; }

        label { display: block; font-weight: 500; margin-bottom: 4px; }

        .description {
            color: var(--description-fg);
            font-size: 12px;
            margin-bottom: 6px;
        }

        input[type="text"],
        input[type="number"],
        textarea {
            width: 100%;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 13px;
            font-family: var(--vscode-font-family);
            outline: none;
        }

        input:focus, textarea:focus { border-color: var(--link-fg); }

        textarea {
            resize: vertical;
            min-height: 80px;
            font-family: var(--vscode-font-family, monospace);
        }

        .inline-group {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .inline-group input[type="number"] { width: 120px; }

        .inline-group .unit {
            color: var(--description-fg);
            font-size: 12px;
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checkbox-group input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }

        .checkbox-group label {
            margin-bottom: 0;
            cursor: pointer;
        }

        .radio-group { display: flex; flex-direction: column; gap: 8px; }

        .radio-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .radio-item input[type="radio"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }

        .radio-item input[type="radio"]:disabled { cursor: not-allowed; }

        .radio-item label {
            margin-bottom: 0;
            cursor: pointer;
        }

        .radio-item input[type="radio"]:disabled + label {
            cursor: not-allowed;
            opacity: 0.5;
        }

        .actions {
            margin-top: 32px;
            display: flex;
            gap: 12px;
            align-items: center;
        }

        .btn-primary {
            background: var(--button-bg);
            color: var(--button-fg);
            border: none;
            border-radius: 4px;
            padding: 8px 20px;
            font-size: 13px;
            cursor: pointer;
            font-weight: 500;
        }

        .btn-primary:hover { background: var(--button-hover); }

        .btn-secondary {
            background: transparent;
            color: var(--fg);
            border: 1px solid var(--section-border);
            border-radius: 4px;
            padding: 7px 16px;
            font-size: 13px;
            cursor: pointer;
        }

        .btn-secondary:hover { background: var(--input-bg); }

        .status-msg {
            font-size: 12px;
            color: var(--description-fg);
            display: none;
        }

        .status-msg.show { display: inline; }
        .status-msg.success { color: #4ec9b0; }

        .link {
            color: var(--link-fg);
            text-decoration: none;
            cursor: pointer;
        }

        .link:hover { text-decoration: underline; }

        .cookie-section .input-wrapper {
            position: relative;
        }

        .cookie-section textarea { padding-right: 80px; }

        .clear-btn {
            position: absolute;
            right: 8px;
            top: 8px;
            background: transparent;
            color: var(--description-fg);
            border: 1px solid var(--section-border);
            border-radius: 3px;
            padding: 2px 8px;
            font-size: 11px;
            cursor: pointer;
        }

        .clear-btn:hover {
            color: var(--fg);
            border-color: var(--fg);
        }

        .info-box {
            background: var(--input-bg);
            border-left: 3px solid var(--link-fg);
            padding: 10px 14px;
            border-radius: 0 4px 4px 0;
            margin-bottom: 16px;
            font-size: 12px;
            line-height: 1.7;
            color: var(--description-fg);
        }

        .info-box strong { color: var(--fg); }
    </style>
</head>
<body>
    <h1>⚙ Token Viewer</h1>
    <p class="subtitle">配置 Token 监控的各项参数</p>

    <div class="section">
        <div class="section-title">🔐 账户配置</div>

        <div class="info-box">
            <strong>获取 Cookie 方法：</strong><br>
            1. 浏览器打开 <a class="link" id="loginUrlLink" href="${XIAOMI_LOGIN_URL}">${XIAOMI_LOGIN_URL}</a><br>
            2. 登录后按 <strong>F12</strong> → Network → 找到请求 → Headers → 复制 Cookie 的值
        </div>

        <div class="form-group">
            <label>小米 MiMo 计费模式</label>
            <div class="radio-group">
                ${planRadios}
            </div>
        </div>

        <div class="form-group cookie-section">
            <label for="cookie">Cookie</label>
            <div class="description">粘贴从浏览器获取的完整 Cookie 字符串</div>
            <div class="input-wrapper">
                <textarea id="cookie" placeholder="粘贴完整的 Cookie 字符串..." rows="3">${escapeHtml(cookie)}</textarea>
                <button class="clear-btn" onclick="document.getElementById('cookie').value=''">清空</button>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">⏱ 刷新设置</div>

        <div class="form-group">
            <label for="refreshInterval">自动刷新间隔</label>
            <div class="description">Token 数据自动刷新的时间间隔，最小 10 秒</div>
            <div class="inline-group">
                <input type="number" id="refreshInterval" value="${refreshInterval}" min="10" step="1">
                <span class="unit">秒</span>
            </div>
        </div>

        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="showInStatusBar" ${showInStatusBar ? 'checked' : ''}>
                <label for="showInStatusBar">在状态栏显示 Token 信息</label>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">🔔 通知设置</div>

        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="enableUsageNotification" ${enableUsageNotification ? 'checked' : ''}>
                <label for="enableUsageNotification">启用用量报告通知</label>
            </div>
            <div class="description" style="margin-top: 4px;">定期弹出通知，显示 Token 消耗情况</div>
        </div>

        <div class="form-group">
            <label for="notificationInterval">通知间隔</label>
            <div class="description">用量报告通知的触发间隔</div>
            <div class="inline-group">
                <input type="number" id="notificationInterval" value="${notificationInterval}" min="5" step="5">
                <span class="unit">分钟</span>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">⚠️ 告警设置</div>

        <div class="form-group">
            <label for="alertThreshold">告警阈值</label>
            <div class="description">当剩余 Token 小于等于此值时，状态栏显示警告色并弹出提示</div>
            <div class="inline-group">
                <input type="number" id="alertThreshold" value="${alertThreshold}" min="0" step="100000">
                <span class="unit">tokens</span>
            </div>
        </div>
    </div>

    <div class="actions">
        <button class="btn-primary" id="saveBtn" onclick="save()">保存设置</button>
        <button class="btn-secondary" onclick="resetDefaults()">恢复默认</button>
        <span class="status-msg" id="statusMsg">✓ 已保存</span>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function save() {
            const cookie = document.getElementById('cookie').value.trim();
            const planTypeEl = document.querySelector('input[name="planType"]:checked');
            const xiaomiPlanType = planTypeEl ? planTypeEl.value : 'cn';
            const refreshInterval = parseInt(document.getElementById('refreshInterval').value) || 10;
            const alertThreshold = parseInt(document.getElementById('alertThreshold').value) || 10000000;
            const enableUsageNotification = document.getElementById('enableUsageNotification').checked;
            const notificationInterval = parseInt(document.getElementById('notificationInterval').value) || 30;
            const showInStatusBar = document.getElementById('showInStatusBar').checked;

            if (refreshInterval < 10) {
                alert('刷新间隔不能小于 10 秒');
                return;
            }
            if (notificationInterval < 5) {
                alert('通知间隔不能小于 5 分钟');
                return;
            }

            vscode.postMessage({
                type: 'save',
                cookie,
                xiaomiPlanType,
                refreshInterval,
                alertThreshold,
                enableUsageNotification,
                notificationInterval,
                showInStatusBar,
            });
        }

        function resetDefaults() {
            document.getElementById('cookie').value = '';
            document.getElementById('plan-cn').checked = true;
            document.getElementById('refreshInterval').value = 10;
            document.getElementById('alertThreshold').value = 10000000;
            document.getElementById('enableUsageNotification').checked = true;
            document.getElementById('notificationInterval').value = 30;
            document.getElementById('showInStatusBar').checked = true;
        }

        window.addEventListener('message', (event) => {
            if (event.data.type === 'saved') {
                const msg = document.getElementById('statusMsg');
                msg.classList.add('show', 'success');
                setTimeout(() => msg.classList.remove('show'), 2000);
            }
        });

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                save();
            }
        });
    </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
