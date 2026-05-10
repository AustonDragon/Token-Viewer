import * as vscode from 'vscode';
import * as crypto from 'crypto';

export const CALLBACK_PATH = 'callback';

export async function startBrowserFetch(
    context: vscode.ExtensionContext,
    platformApiBase: string
): Promise<void> {
    const state = crypto.randomBytes(16).toString('hex');
    await context.globalState.update('tokenViewer.oauthState', state);

    const callbackUrl = `${platformApiBase}?_tv_cb=1&_tv_state=${state}`;
    await vscode.env.openExternal(vscode.Uri.parse(callbackUrl));

    vscode.window.showInformationMessage(
        '已打开浏览器，请在浏览器中触发 Usage 请求，Cookie 将自动回传。'
    );
}

export function handleCallbackUri(
    context: vscode.ExtensionContext,
    uri: vscode.Uri,
    onRefresh: (ctx: vscode.ExtensionContext) => Promise<void>
): void {
    const params = new URLSearchParams(uri.query);

    const cookieEncoded = params.get('cookie');
    const state = params.get('state');

    if (!cookieEncoded) {
        vscode.window.showErrorMessage('Token Viewer: 回调中未包含 Cookie');
        return;
    }

    const savedState = context.globalState.get<string>('tokenViewer.oauthState');
    if (!state || !savedState || state !== savedState) {
        vscode.window.showErrorMessage('Token Viewer: State 校验失败，可能是过期或伪造的回调');
        return;
    }

    context.globalState.update('tokenViewer.oauthState', undefined);

    const cookie = base64UrlDecode(cookieEncoded);

    vscode.workspace.getConfiguration('tokenViewer')
        .update('cookie', cookie, vscode.ConfigurationTarget.Global)
        .then(() => {
            vscode.window.showInformationMessage('✅ Cookie 已从浏览器获取并保存，正在刷新...');
            return onRefresh(context);
        });
}

function base64UrlDecode(input: string): string {
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf-8');
}
