import * as vscode from 'vscode';

// ============================================================
// Token Viewer - 小米 MiMo Credits 监控插件
// 专注于 platform.xiaomimimo.com 的 Credits 额度监控
// ============================================================

/** 小米 MiMo 平台配置 */
const XIAOMI_CONFIG = {
    apiUrl: 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage',
    usageApiUrl: 'https://platform.xiaomimimo.com/api/v1/usage/token-plan/list',
    jsonPath: 'data.usage.items[0].limit - data.usage.items[0].used',
    totalPath: 'data.usage.items[0].limit',
    usedPath: 'data.usage.items[0].used',
    loginUrl: 'https://platform.xiaomimimo.com/console/plan-manage',
    headerKey: 'Cookie',
};

/** 各模型 Credit 消耗比例 */
const MODEL_RATES = {
    'mimo-v2.5-pro': { cacheHit: 2.5, input: 300, output: 600 },
    'mimo-v2.5':     { cacheHit: 2,   input: 100, output: 200 },
};

/** 全局状态 */
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let refreshTimer: NodeJS.Timeout | undefined;
let lastTokenCount: number | undefined;
let alertShown: boolean = false;
let cookieErrorCount: number = 0;
let isRefreshingCookie: boolean = false;
let isFetching: boolean = false;
let configDebounce: ReturnType<typeof setTimeout> | undefined;
let lastNotifyTime: number | undefined;
let lastNotifyToken: number | undefined;
/** 各模型上次用量快照（用于半小时报告计算差值） */
let lastModelUsage: Record<string, number> | undefined;

// ============================================================
// 激活函数 - 插件入口
// ============================================================
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Token Viewer');
    outputChannel.appendLine('[Token Viewer] 插件已激活（小米 MiMo Credits 监控）');

    // 创建状态栏项
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(sync~spin) Credits: 加载中...';
    statusBarItem.tooltip = 'Token Viewer - 点击刷新';
    statusBarItem.command = 'tokenViewer.refresh';
    statusBarItem.show();

    // 注册刷新命令
    const refreshCommand = vscode.commands.registerCommand(
        'tokenViewer.refresh',
        () => {
            outputChannel.appendLine('[Token Viewer] 手动触发刷新');
            fetchTokenCount(context);
        }
    );

    // 注册配置命令（只需粘贴 Cookie）
    const configureCommand = vscode.commands.registerCommand(
        'tokenViewer.configure',
        () => configureCookie(context)
    );

    // 监听配置变更（防抖 500ms）
    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tokenViewer')) {
            if (configDebounce) { clearTimeout(configDebounce); }
            configDebounce = setTimeout(() => {
                outputChannel.appendLine('[Token Viewer] 配置已变更，重新启动定时器');
                setupTimer(context);
                fetchTokenCount(context);
            }, 500);
        }
    });

    context.subscriptions.push(statusBarItem, outputChannel, refreshCommand, configureCommand, configChangeListener);

    // 代理状态栏
    proxyStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    updateProxyStatusBar();
    proxyStatusBarItem.show();

    // 注册代理命令
    const proxyStartCmd = vscode.commands.registerCommand('tokenViewer.proxyStart', () => startProxy(context));
    const proxyStopCmd = vscode.commands.registerCommand('tokenViewer.proxyStop', () => stopProxy());
    const proxyStatusCmd = vscode.commands.registerCommand('tokenViewer.proxyStatus', () => {
        const status = proxyServer ? `运行中 :${getProxyPort()}` : '已停止';
        vscode.window.showInformationMessage(`Token Viewer 代理状态: ${status}`);
    });

    // 浏览器自动获取 Cookie
    const browserCaptureCmd = vscode.commands.registerCommand('tokenViewer.browserCapture', () => captureCookieViaBrowser(context));

    context.subscriptions.push(proxyStatusBarItem, proxyStartCmd, proxyStopCmd, proxyStatusCmd, browserCaptureCmd);

    // 恢复上次的 Credits
    lastTokenCount = context.globalState.get<number>('tokenViewer.lastTokenCount');
    lastNotifyTime = context.globalState.get<number>('tokenViewer.lastNotifyTime');
    lastNotifyToken = context.globalState.get<number>('tokenViewer.lastNotifyToken');

    // 如果配置中没有 Cookie 但 globalState 中有保存的，自动恢复
    const config = vscode.workspace.getConfiguration('tokenViewer');
    const currentCookie = config.get<Record<string, string>>('headers', {})['Cookie'];
    if (!currentCookie) {
        const savedCookie = context.globalState.get<string>('tokenViewer.savedCookie');
        if (savedCookie) {
            await config.update('headers', { Cookie: savedCookie }, vscode.ConfigurationTarget.Global);
            outputChannel.appendLine('[Token Viewer] 已从本地缓存恢复 Cookie');
        }
    }

    // 首次刷新
    fetchTokenCount(context);

    // 启动定时刷新
    setupTimer(context);
}

export function deactivate(): void {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
    if (configDebounce) {
        clearTimeout(configDebounce);
        configDebounce = undefined;
    }
    stopProxy();
}

// ============================================================
// 配置 Cookie（唯一需要用户操作的步骤）
// ============================================================
async function configureCookie(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('tokenViewer');
    const currentHeaders = config.get<Record<string, string>>('headers', {});
    const currentCookie = currentHeaders['Cookie'] || '';

    const cookieValue = await vscode.window.showInputBox({
        prompt: '请粘贴小米 MiMo 的 Cookie\n\n' +
            '获取方法：\n' +
            '1. 浏览器打开 https://platform.xiaomimimo.com/console/plan-manage\n' +
            '2. 登录后按 F12 → Network → 找到请求 → Headers → 复制 Cookie 的值',
        placeHolder: '粘贴完整的 Cookie 字符串...',
        value: currentCookie,
        validateInput: (value) => {
            if (!value || value.trim() === '') { return 'Cookie 不能为空'; }
            return null;
        },
    });

    if (cookieValue === undefined) {
        vscode.window.showInformationMessage('Token Viewer 配置已取消');
        return;
    }

    // 保存 Cookie
    const headers: Record<string, string> = { 'Cookie': cookieValue };
    await config.update('headers', headers, vscode.ConfigurationTarget.Global);

    outputChannel.appendLine('[Token Viewer] ✅ Cookie 已更新');
    vscode.window.showInformationMessage('✅ Cookie 已保存，正在刷新...');

    // 立即刷新
    fetchTokenCount(context);
}

// ============================================================
// 读取配置
// ============================================================
function getConfig() {
    const config = vscode.workspace.getConfiguration('tokenViewer');
    return {
        headers: config.get<Record<string, string>>('headers', {}),
        refreshInterval: config.get<number>('refreshInterval', 10),
        alertThreshold: config.get<number>('alertThreshold', 100000000),
    };
}

// ============================================================
// 设置定时刷新
// ============================================================
function setupTimer(context: vscode.ExtensionContext): void {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }

    const config = getConfig();
    const intervalMs = config.refreshInterval * 1000;

    if (intervalMs > 0) {
        refreshTimer = setInterval(() => {
            fetchTokenCount(context);
        }, intervalMs);
        outputChannel.appendLine(`[Token Viewer] 定时器已启动，间隔 ${config.refreshInterval} 秒`);
    }
}

// ============================================================
// 获取 Credits
// ============================================================
async function fetchTokenCount(context: vscode.ExtensionContext): Promise<void> {
    if (isFetching) { return; }
    isFetching = true;

    const config = getConfig();

    // 检查 Cookie 是否配置
    if (!config.headers['Cookie']) {
        statusBarItem.text = '$(warning) Credits: 未配置';
        statusBarItem.tooltip = '请点击状态栏 → Token Viewer: 配置 Cookie';
        outputChannel.appendLine('[Token Viewer] 警告：未配置 Cookie，请运行 Token Viewer: 配置 Cookie');
        return;
    }

    try {
        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...config.headers,
        };

        outputChannel.appendLine(`[Token Viewer] 正在请求: ${XIAOMI_CONFIG.apiUrl}`);

        const responseBody = await httpGet(XIAOMI_CONFIG.apiUrl, headers);

        // 解析 JSON
        let jsonData: any;
        try {
            jsonData = JSON.parse(responseBody);
        } catch (parseError) {
            const errorMsg = `JSON 解析失败: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
            handleFetchError(errorMsg, `响应内容: ${responseBody.substring(0, 500)}`);
            return;
        }

        // 提取 Credits（剩余量）
        const tokenCount = resolveJsonPath(jsonData, XIAOMI_CONFIG.jsonPath);

        if (tokenCount === undefined || tokenCount === null) {
            handleFetchError(
                `无法按路径 "${XIAOMI_CONFIG.jsonPath}" 解析 Token 数量`,
                `JSON 结构: ${JSON.stringify(jsonData).substring(0, 500)}`
            );
            return;
        }

        const tokenNum = Number(tokenCount);
        if (isNaN(tokenNum)) {
            handleFetchError(
                `路径 "${XIAOMI_CONFIG.jsonPath}" 的值不是有效数字: ${tokenCount}`,
                `JSON 结构: ${JSON.stringify(jsonData).substring(0, 500)}`
            );
            return;
        }

        // 提取总量和已用量，计算百分比
        let percentage: number | undefined;
        let totalTokens: number | undefined;
        const totalVal = resolveJsonPath(jsonData, XIAOMI_CONFIG.totalPath);
        const usedVal = resolveJsonPath(jsonData, XIAOMI_CONFIG.usedPath);
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

        // ✅ 成功
        cookieErrorCount = 0;
        lastTokenCount = tokenNum;
        context.globalState.update('tokenViewer.lastTokenCount', tokenNum);

        // 半小时用量提醒（按模型分拆）
        const nowMs = Date.now();
        const NOTIFY_INTERVAL = 30 * 60 * 1000;
        if (lastNotifyTime !== undefined && (nowMs - lastNotifyTime) >= NOTIFY_INTERVAL) {
            const elapsed = Math.round((nowMs - lastNotifyTime) / 60000);
            reportModelUsage(headers, tokenNum, elapsed).catch(err => {
                outputChannel.appendLine(`[Token Viewer] 模型用量报告失败: ${err instanceof Error ? err.message : String(err)}`);
            });
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

        // 格式化显示（缩写）
        const compact = formatCompact(tokenNum);
        const fullFormatted = tokenNum.toLocaleString('zh-CN');
        const percentStr = percentage !== undefined ? ` (${percentage.toFixed(1)}%)` : '';
        statusBarItem.text = `$(robot) ${compact}${percentStr}`;
        const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        let tooltipText = `Token Viewer - 小米 MiMo Credits\n当前剩余: ${fullFormatted}（${compact}）`;
        if (percentage !== undefined) {
            tooltipText += `\n剩余百分比: ${percentage.toFixed(1)}%`;
        }
        if (totalTokens !== undefined) {
            tooltipText += `\n总量: ${totalTokens.toLocaleString('zh-CN')}（${formatCompact(totalTokens)}）`;
        }

        // 获取当天各模型用量
        const todayUsage = await fetchTodayUsage(headers);
        if (todayUsage) {
            tooltipText += `\n\n--- 今日用量 ---`;
            tooltipText += todayUsage;
        }

        tooltipText += `\n\n--- 消耗比例 (Credits/Token) ---`;
        for (const [model, rates] of Object.entries(MODEL_RATES)) {
            tooltipText += `\n${model}: 缓存${rates.cacheHit} | 输入${rates.input} | 输出${rates.output}`;
        }
        tooltipText += `\nTTS 系列: 免费`;
        tooltipText += `\n\n最后更新: ${now}\n点击刷新`;
        statusBarItem.tooltip = tooltipText;

        // 告警
        if (tokenNum <= config.alertThreshold) {
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            if (!alertShown) {
                alertShown = true;
                vscode.window.showWarningMessage(
                    `⚠️ Credits 不足！当前剩余: ${fullFormatted}${percentStr}，阈值: ${config.alertThreshold.toLocaleString('zh-CN')}`
                );
            }
        } else {
            statusBarItem.backgroundColor = undefined;
            alertShown = false;
        }

        outputChannel.appendLine(`[Token Viewer] ✅ Credits: ${fullFormatted}${percentStr}`);

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // 检测认证错误
        if (isAuthError(errorMsg)) {
            cookieErrorCount++;
            outputChannel.appendLine(`[Token Viewer] 🔔 认证错误 (第 ${cookieErrorCount} 次): ${errorMsg}`);

            if (cookieErrorCount >= 2 && !isRefreshingCookie) {
                await triggerCookieRefresh(context);
            } else {
                handleFetchError(errorMsg, 'Cookie 可能已过期，连续失败 2 次后将自动打开登录页面');
            }
        } else {
            handleFetchError(errorMsg, undefined);
        }
    } finally {
        isFetching = false;
    }
}

// ============================================================
// 按模型用量报告
// ============================================================
async function reportModelUsage(
    headers: Record<string, string>,
    currentCredits: number,
    elapsedMin: number
): Promise<void> {
    const postHeaders: Record<string, string> = {
        ...headers,
        'origin': 'https://platform.xiaomimimo.com',
        'referer': 'https://platform.xiaomimimo.com/console/plan-manage',
        'x-timezone': 'Asia/Shanghai',
    };
    const now = new Date();
    const body = JSON.stringify({ year: now.getFullYear(), month: now.getMonth() + 1 });
    const url = buildUsageUrl(headers['Cookie'] || '');
    const responseBody = await httpPost(url, postHeaders, body);
    const json = JSON.parse(responseBody);

    if (json.code !== 0 || !Array.isArray(json.data)) {
        throw new Error(`API 返回异常: code=${json.code}`);
    }

    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayEntries: Record<string, { inputHit: number; inputMiss: number; output: number; requests: number }> = {};

    for (const item of json.data) {
        if (item.date !== today) { continue; }
        const model = item.model;
        if (!todayEntries[model]) {
            todayEntries[model] = { inputHit: 0, inputMiss: 0, output: 0, requests: 0 };
        }
        todayEntries[model].inputHit += item.inputHitToken || 0;
        todayEntries[model].inputMiss += item.inputMissToken || 0;
        todayEntries[model].output += item.outputToken || 0;
        todayEntries[model].requests += item.requestCount || 0;
    }

    // 计算差值
    const lines: string[] = [];
    if (lastModelUsage) {
        for (const [model, entry] of Object.entries(todayEntries)) {
            const prev = lastModelUsage[model] || 0;
            const delta = entry.inputHit + entry.inputMiss + entry.output - prev;
            if (delta > 0) {
                lines.push(`  ${model}: ${formatCompact(delta)} (${entry.requests}次)`);
            }
        }
    }

    // 更新快照
    const newSnapshot: Record<string, number> = {};
    for (const [model, entry] of Object.entries(todayEntries)) {
        newSnapshot[model] = entry.inputHit + entry.inputMiss + entry.output;
    }
    lastModelUsage = newSnapshot;

    // 发送通知
    if (lines.length > 0) {
        const currentCompact = formatCompact(currentCredits);
        vscode.window.showInformationMessage(
            `🤖 ${elapsedMin}分钟用量报告\n${lines.join('\n')}\n💰 Credits 剩余: ${currentCompact}`
        );
    } else {
        // 首次快照，无对比数据
        const currentCompact = formatCompact(currentCredits);
        const summary = Object.entries(todayEntries)
            .map(([m, e]) => `  ${m}: ${formatCompact(e.inputHit + e.inputMiss + e.output)}`)
            .join('\n');
        if (summary) {
            vscode.window.showInformationMessage(
                `🤖 今日累计用量\n${summary}\n💰 Credits 剩余: ${currentCompact}`
            );
        }
    }
}

// ============================================================
// 构建用量 API URL（从 Cookie 提取 api-platform_ph 拼入查询参数）
// ============================================================
function buildUsageUrl(cookie: string): string {
    const match = cookie.match(/api-platform_ph="?([^";]+)/);
    if (match) {
        return `${XIAOMI_CONFIG.usageApiUrl}?api-platform_ph=${encodeURIComponent(match[1])}`;
    }
    return XIAOMI_CONFIG.usageApiUrl;
}

// ============================================================
// 获取当天各模型用量（tooltip 用）
// ============================================================
async function fetchTodayUsage(headers: Record<string, string>): Promise<string | null> {
    try {
        const postHeaders: Record<string, string> = {
            ...headers,
            'origin': 'https://platform.xiaomimimo.com',
            'referer': 'https://platform.xiaomimimo.com/console/plan-manage',
            'x-timezone': 'Asia/Shanghai',
        };
        const now = new Date();
        const body = JSON.stringify({ year: now.getFullYear(), month: now.getMonth() + 1 });
        const url = buildUsageUrl(headers['Cookie'] || '');
        outputChannel.appendLine(`[Token Viewer] 请求今日用量: ${url}`);
        const responseBody = await httpPost(url, postHeaders, body);
        outputChannel.appendLine(`[Token Viewer] 用量 API 响应: ${responseBody.substring(0, 300)}`);
        const json = JSON.parse(responseBody);

        if (json.code !== 0 || !Array.isArray(json.data)) {
            outputChannel.appendLine(`[Token Viewer] 用量 API 返回异常: code=${json.code}, message=${json.message}`);
            return null;
        }

        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const todayEntries: Record<string, { total: number; inputHit: number; inputMiss: number; output: number; requests: number }> = {};

        for (const item of json.data) {
            if (item.date !== today) { continue; }
            const model = item.model;
            if (!todayEntries[model]) {
                todayEntries[model] = { total: 0, inputHit: 0, inputMiss: 0, output: 0, requests: 0 };
            }
            todayEntries[model].total += item.totalToken || 0;
            todayEntries[model].inputHit += item.inputHitToken || 0;
            todayEntries[model].inputMiss += item.inputMissToken || 0;
            todayEntries[model].output += item.outputToken || 0;
            todayEntries[model].requests += item.requestCount || 0;
        }

        const lines: string[] = [];
        for (const [model, e] of Object.entries(todayEntries)) {
            const credits = calcCredits(model, e.inputHit, e.inputMiss, e.output);
            const avgPerToken = e.total > 0 ? credits / e.total : 0;
            lines.push(`${model}`);
            lines.push(`  ${formatCompact(e.total)} token  |  ${formatCompact(credits)} credits  |  请求${e.requests}次`);
            lines.push(`  平均每token消耗 ≈ ${avgPerToken.toFixed(1)} credits`);
        }

        if (lines.length === 0) {
            outputChannel.appendLine(`[Token Viewer] 今日无用量数据 (today=${today}, 返回${json.data.length}条记录)`);
        }

        return lines.length > 0 ? '\n' + lines.join('\n') : null;
    } catch (err) {
        outputChannel.appendLine(`[Token Viewer] 今日用量获取失败: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}

/** 根据模型和 token 分类计算 credits 消耗 */
function calcCredits(model: string, inputHit: number, inputMiss: number, output: number): number {
    const rates = MODEL_RATES[model as keyof typeof MODEL_RATES];
    if (!rates) { return 0; }
    return inputHit * rates.cacheHit + inputMiss * rates.input + output * rates.output;
}

// ============================================================
// 认证错误检测
// ============================================================
function isAuthError(message: string): boolean {
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

// ============================================================
// Cookie 过期自动更新流程
// ============================================================
async function triggerCookieRefresh(context: vscode.ExtensionContext): Promise<void> {
    if (isRefreshingCookie) { return; }
    isRefreshingCookie = true;

    try {
        outputChannel.appendLine('[Token Viewer] 🔔 Cookie 过期，触发自动更新流程');

        // 打开登录页面
        vscode.env.openExternal(vscode.Uri.parse(XIAOMI_CONFIG.loginUrl));

        // 弹出提示
        const action = await vscode.window.showWarningMessage(
            '⚠️ 小米 MiMo 的 Cookie 已过期！\n\n' +
            '已打开登录页面，请在浏览器中登录后，复制新的 Cookie。\n' +
            '然后点击「更新 Cookie」按钮。',
            '更新 Cookie',
            '稍后再说'
        );

        if (action !== '更新 Cookie') {
            outputChannel.appendLine('[Token Viewer] 用户选择稍后更新 Cookie');
            isRefreshingCookie = false;
            return;
        }

        // 弹出输入框
        const newCookie = await vscode.window.showInputBox({
            prompt: '请粘贴新的 Cookie\n\n获取方法：浏览器登录 → F12 → Network → Headers → 复制 Cookie',
            placeHolder: '粘贴新的 Cookie 字符串...',
            validateInput: (value) => {
                if (!value || value.trim() === '') { return 'Cookie 不能为空'; }
                return null;
            },
        });

        if (newCookie === undefined) {
            outputChannel.appendLine('[Token Viewer] 用户取消了 Cookie 更新');
            isRefreshingCookie = false;
            return;
        }

        // 保存
        const vscodeConfig = vscode.workspace.getConfiguration('tokenViewer');
        await vscodeConfig.update('headers', { 'Cookie': newCookie }, vscode.ConfigurationTarget.Global);

        outputChannel.appendLine('[Token Viewer] ✅ Cookie 已更新，正在重新验证...');
        cookieErrorCount = 0;

        await fetchTokenCount(context);
        vscode.window.showInformationMessage('✅ Cookie 已更新，Credits 数据已刷新！');

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[Token Viewer] Cookie 更新流程出错: ${msg}`);
        vscode.window.showErrorMessage(`Cookie 更新失败: ${msg}`);
    } finally {
        isRefreshingCookie = false;
    }
}

// ============================================================
// 错误处理
// ============================================================
function handleFetchError(message: string, detail?: string): void {
    if (lastTokenCount !== undefined) {
        const compact = formatCompact(lastTokenCount);
        const formatted = lastTokenCount.toLocaleString('zh-CN');
        statusBarItem.text = `$(warning) ${compact} ⚠`;
        statusBarItem.tooltip = `Token Viewer - 请求失败\n${message}\n保留上次的值: ${formatted}`;
    } else {
        statusBarItem.text = '$(error) Credits: Error';
        statusBarItem.tooltip = `Token Viewer - 请求失败\n${message}`;
    }

    outputChannel.appendLine(`[Token Viewer] 错误: ${message}`);
    if (detail) {
        outputChannel.appendLine(`[Token Viewer] 详情: ${detail}`);
    }
    outputChannel.appendLine('');
}

// ============================================================
// 数字缩写格式化
// ============================================================
function formatCompact(num: number): string {
    const abs = Math.abs(num);
    if (abs >= 1e12) { return (num / 1e12).toFixed(1).replace(/\.0$/, '') + 'T'; }
    if (abs >= 1e9) { return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; }
    if (abs >= 1e6) { return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; }
    if (abs >= 1e4) { return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; }
    return num.toLocaleString('zh-CN');
}

// ============================================================
// JSON 路径解析（支持减法表达式）
// ============================================================
function resolveJsonPath(obj: any, path: string): any {
    if (!path) { return obj; }

    const trimmedPath = path.trim();

    // 减法表达式：data.usage.items[0].limit - data.usage.items[0].used
    if (trimmedPath.includes(' - ')) {
        const parts = trimmedPath.split(' - ');
        if (parts.length >= 2) {
            let result: number | undefined;
            for (const part of parts) {
                const value = resolveSinglePath(obj, part.trim());
                const num = Number(value);
                if (isNaN(num)) { return undefined; }
                result = result === undefined ? num : result - num;
            }
            return result;
        }
    }

    return resolveSinglePath(obj, trimmedPath);
}

function resolveSinglePath(obj: any, path: string): any {
    if (!path) { return obj; }

    const segments = path.split('.').filter(s => s.length > 0);
    let current = obj;

    for (const segment of segments) {
        if (current === null || current === undefined) { return undefined; }

        const arrayMatch = segment.match(/^([^\[]+)\[(\d+)\]$/);
        if (arrayMatch) {
            const fieldName = arrayMatch[1];
            const index = parseInt(arrayMatch[2], 10);
            current = current[fieldName];
            if (!Array.isArray(current)) { return undefined; }
            current = current[index];
        } else {
            current = current[segment];
        }
    }

    return current;
}

// ============================================================
// HTTP GET 请求
// ============================================================
function httpGet(url: string, headers: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https');
        const httpModule = isHttps ? require('https') : require('http');
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: headers,
            timeout: 15000,
        };

        const req = httpModule.request(options, (res: any) => {
            let data = '';
            res.on('data', (chunk: string) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}\n响应: ${data.substring(0, 500)}`));
                }
            });
        });

        req.on('error', (error: Error) => {
            reject(new Error(`网络请求失败: ${error.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时（15 秒）'));
        });

        req.end();
    });
}

// ============================================================
// HTTP POST 请求
// ============================================================
function httpPost(url: string, headers: Record<string, string>, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https');
        const httpModule = isHttps ? require('https') : require('http');
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
            timeout: 15000,
        };

        const req = httpModule.request(options, (res: any) => {
            let data = '';
            res.on('data', (chunk: string) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}\n响应: ${data.substring(0, 500)}`));
                }
            });
        });

        req.on('error', (error: Error) => {
            reject(new Error(`网络请求失败: ${error.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时（15 秒）'));
        });

        req.write(body);
        req.end();
    });
}

// ============================================================
// 系统代理绕过
// ============================================================
function bypassSystemProxy<T>(fn: () => T): T {
    const saved: Record<string, string | undefined> = {};
    const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
    for (const key of keys) {
        saved[key] = process.env[key];
        delete process.env[key];
    }
    try {
        return fn();
    } finally {
        for (const key of keys) {
            if (saved[key] !== undefined) { process.env[key] = saved[key]; }
            else { delete process.env[key]; }
        }
    }
}

// ============================================================
// 浏览器自动获取 Cookie（基于 Puppeteer）
// ============================================================

function findChromePath(): string | undefined {
    const fs = require('fs');
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) { return p; }
    }
    return undefined;
}

async function captureCookieViaBrowser(context: vscode.ExtensionContext): Promise<void> {
    const puppeteer = require('puppeteer-core');
    const chromePath = findChromePath();

    if (!chromePath) {
        vscode.window.showErrorMessage('未找到 Chrome 或 Edge 浏览器');
        return;
    }

    let browser: any;
    try {
        vscode.window.showInformationMessage('正在启动浏览器，请在浏览器中登录小米账号...');

        // 使用固定目录保存浏览器用户数据，保留登录状态
        const userDataDir = require('path').join(context.globalStorageUri.fsPath, 'browser-profile');
        const fs = require('fs');
        if (!fs.existsSync(userDataDir)) { fs.mkdirSync(userDataDir, { recursive: true }); }

        browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: false,
            defaultViewport: null,
            userDataDir,
            args: ['--no-first-run', '--no-default-browser-check'],
        });

        const page = await browser.newPage();
        await page.goto(XIAOMI_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        outputChannel.appendLine('[Token Viewer] 等待用户点击"我已登录"按钮...');

        // 等待用户点击"我已登录"按钮
        const clicked = await vscode.window.showInformationMessage(
            '请在浏览器中完成登录，登录成功后点击下方按钮',
            '我已登录'
        );

        if (clicked !== '我已登录') {
            throw new Error('用户取消了登录确认');
        }

        // 检查浏览器是否仍然打开
        if (!browser || !browser.connected) {
            throw new Error('浏览器已关闭，请重新运行命令');
        }

        outputChannel.appendLine('[Token Viewer] 用户确认登录，正在提取 Cookie...');

        // 等待 Cookie 稳定
        await new Promise(r => setTimeout(r, 2000));

        // 从浏览器级别获取所有 Cookie（不依赖特定页面）
        let cookies: any[];
        try {
            cookies = await browser.cookies();
        } catch {
            // 如果 browser.cookies() 不可用，尝试从所有页面获取
            const pages = await browser.pages();
            cookies = [];
            for (const p of pages) {
                try {
                    const c = await p.cookies();
                    cookies.push(...c);
                } catch { /* 跳过不可用的页面 */ }
            }
        }
        const cookieStr = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');

        if (!cookieStr) {
            throw new Error('未获取到有效 Cookie');
        }

        // 保存到 VS Code 配置
        const vscodeConfig = vscode.workspace.getConfiguration('tokenViewer');
        await vscodeConfig.update('headers', { Cookie: cookieStr }, vscode.ConfigurationTarget.Global);

        // 保存到 globalState 以便下次自动恢复
        await context.globalState.update('tokenViewer.savedCookie', cookieStr);

        outputChannel.appendLine('[Token Viewer] ✅ Cookie 已通过浏览器自动获取并保存');
        vscode.window.showInformationMessage('✅ Cookie 已自动获取并保存！');

        await browser.close();
        browser = null;

        // 立即刷新
        cookieErrorCount = 0;
        await fetchTokenCount(context);

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[Token Viewer] 浏览器获取 Cookie 失败: ${msg}`);
        vscode.window.showErrorMessage(`获取 Cookie 失败: ${msg}`);
        if (browser) {
            try { await browser.close(); } catch { /* ignore */ }
        }
    }
}

// ============================================================
// ASN.1 DER 编码原语（用于 X.509 证书生成）
// ============================================================

const OID = {
    rsaEncryption:    '1.2.840.113549.1.1.1',
    sha256WithRSA:    '1.2.840.113549.1.1.11',
    commonName:       '2.5.4.3',
    countryName:      '2.5.4.6',
    organizationName: '2.5.4.10',
    basicConstraints: '2.5.29.19',
    subjectAltName:   '2.5.29.17',
    keyUsage:         '2.5.29.15',
};

function derLength(len: number): Buffer {
    if (len < 0x80) { return Buffer.from([len]); }
    if (len < 0x100) { return Buffer.from([0x81, len]); }
    return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derTlv(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(...buffers: Buffer[]): Buffer {
    return derTlv(0x30, Buffer.concat(buffers));
}

function derSet(...buffers: Buffer[]): Buffer {
    return derTlv(0x31, Buffer.concat(buffers));
}

function derInteger(value: Buffer): Buffer {
    if (value[0] & 0x80) {
        return derTlv(0x02, Buffer.concat([Buffer.from([0x00]), value]));
    }
    return derTlv(0x02, value);
}

function derBitString(data: Buffer): Buffer {
    return derTlv(0x03, Buffer.concat([Buffer.from([0x00]), data]));
}

function derOid(oid: string): Buffer {
    const parts = oid.split('.').map(Number);
    const bytes: number[] = [];
    bytes.push(parts[0] * 40 + parts[1]);
    for (let i = 2; i < parts.length; i++) {
        let val = parts[i];
        const stack: number[] = [];
        stack.push(val & 0x7f);
        val >>= 7;
        while (val > 0) {
            stack.push((val & 0x7f) | 0x80);
            val >>= 7;
        }
        bytes.push(...stack.reverse());
    }
    return derTlv(0x06, Buffer.from(bytes));
}

function derUtf8String(str: string): Buffer {
    return derTlv(0x0c, Buffer.from(str, 'utf8'));
}

function derNull(): Buffer {
    return Buffer.from([0x05, 0x00]);
}

function derExplicitTag(tag: number, content: Buffer): Buffer {
    return derTlv(0xa0 | tag, content);
}

function derOctetString(data: Buffer): Buffer {
    return derTlv(0x04, data);
}

function derUtcTime(date: Date): Buffer {
    const y = date.getUTCFullYear();
    const yy = y >= 2000 ? y - 2000 : y;
    const str =
        String(yy).padStart(2, '0') +
        String(date.getUTCMonth() + 1).padStart(2, '0') +
        String(date.getUTCDate()).padStart(2, '0') +
        String(date.getUTCHours()).padStart(2, '0') +
        String(date.getUTCMinutes()).padStart(2, '0') +
        String(date.getUTCSeconds()).padStart(2, '0') + 'Z';
    return derTlv(0x17, Buffer.from(str, 'ascii'));
}

function derContextPrimitive(tag: number, data: Buffer): Buffer {
    return derTlv(0x80 | tag, data);
}

function pemToDer(pem: string): Buffer {
    const base64 = pem.replace(/-----.*-----/g, '').replace(/\s/g, '');
    return Buffer.from(base64, 'base64');
}

function derToPem(der: Buffer, type: string): string {
    const base64 = der.toString('base64');
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`;
}

// ============================================================
// RSA 密钥对和 X.509 证书生成
// ============================================================

interface CertAndKey {
    certPem: string;
    keyPem: string;
    certDer: Buffer;
}

interface CaMaterial extends CertAndKey {
    subjectDer: Buffer;
}

function generateRsaKeyPair(): { privateKeyPem: string; publicKeyDer: Buffer } {
    const { privateKey, publicKey } = require('crypto').generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { privateKeyPem: privateKey, publicKeyDer: publicKey };
}

function buildNameRdn(oid: string, value: string): Buffer {
    return derSet(derSequence(derOid(oid), derUtf8String(value)));
}

function buildValidity(notBefore: Date, notAfter: Date): Buffer {
    return derSequence(derUtcTime(notBefore), derUtcTime(notAfter));
}

function signTbs(tbsDer: Buffer, keyPem: string): Buffer {
    return require('crypto').createSign('SHA256').update(tbsDer).sign(keyPem);
}

function buildSignedCert(tbsDer: Buffer, keyPem: string): Buffer {
    const signature = signTbs(tbsDer, keyPem);
    return derSequence(
        tbsDer,
        derSequence(derOid(OID.sha256WithRSA), derNull()),
        derBitString(signature)
    );
}

function generateCaCert(): CaMaterial {
    const { privateKeyPem, publicKeyDer } = generateRsaKeyPair();
    const serial = Buffer.from(require('crypto').randomBytes(8));
    serial[0] &= 0x7f;

    const now = new Date();
    const tenYears = new Date(now);
    tenYears.setFullYear(tenYears.getFullYear() + 10);

    const subjectDer = Buffer.concat([
        buildNameRdn(OID.countryName, 'CN'),
        buildNameRdn(OID.organizationName, 'Token Viewer'),
        buildNameRdn(OID.commonName, 'Token Viewer Local CA'),
    ]);

    const extensions = derSequence(
        derSequence(
            derOid(OID.basicConstraints),
            derOctetString(derSequence(Buffer.from([0x01])))
        ),
        derSequence(
            derOid(OID.keyUsage),
            derOctetString(derBitString(Buffer.from([0x06])))
        )
    );

    const tbs = derSequence(
        derExplicitTag(0, derInteger(Buffer.from([0x02]))),
        derInteger(serial),
        derSequence(derOid(OID.sha256WithRSA), derNull()),
        subjectDer,
        buildValidity(now, tenYears),
        subjectDer,
        derSequence(derOid(OID.rsaEncryption), derNull()),
        derBitString(publicKeyDer),
        derExplicitTag(3, extensions)
    );

    const certDer = buildSignedCert(tbs, privateKeyPem);
    return {
        certPem: derToPem(certDer, 'CERTIFICATE'),
        keyPem: privateKeyPem,
        certDer,
        subjectDer,
    };
}

function generateDomainCert(hostname: string, ca: CaMaterial): CertAndKey {
    const { privateKeyPem, publicKeyDer } = generateRsaKeyPair();
    const serial = Buffer.from(require('crypto').randomBytes(8));
    serial[0] &= 0x7f;

    const now = new Date();
    const oneYear = new Date(now);
    oneYear.setFullYear(oneYear.getFullYear() + 1);

    const subjectDer = Buffer.concat([
        buildNameRdn(OID.commonName, hostname),
    ]);

    const sanEntry = derTlv(0x82, Buffer.from(hostname, 'ascii'));
    const extensions = derSequence(
        derSequence(
            derOid(OID.basicConstraints),
            derOctetString(derSequence(Buffer.from([0x00])))
        ),
        derSequence(
            derOid(OID.subjectAltName),
            derOctetString(derSequence(sanEntry))
        )
    );

    const tbs = derSequence(
        derExplicitTag(0, derInteger(Buffer.from([0x02]))),
        derInteger(serial),
        derSequence(derOid(OID.sha256WithRSA), derNull()),
        ca.subjectDer,
        buildValidity(now, oneYear),
        subjectDer,
        derSequence(derOid(OID.rsaEncryption), derNull()),
        derBitString(publicKeyDer),
        derExplicitTag(3, extensions)
    );

    const certDer = buildSignedCert(tbs, ca.keyPem);
    return {
        certPem: derToPem(certDer, 'CERTIFICATE'),
        keyPem: privateKeyPem,
        certDer,
    };
}

// ============================================================
// CA 证书安装到 Windows 信任根存储
// ============================================================

async function installCaCertToTrustStore(certDer: Buffer): Promise<boolean> {
    const tmpFile = require('path').join(require('os').tmpdir(), 'token-viewer-ca.der');
    require('fs').writeFileSync(tmpFile, certDer);

    try {
        const { execSync } = require('child_process');
        const psScript = `
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${tmpFile.replace(/\\/g, '\\\\')}')
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
$store.Open('ReadWrite')
$store.Add($cert)
$store.Close()
Write-Output 'OK'
`;
        execSync(`powershell -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return true;
    } catch {
        return false;
    } finally {
        try { require('fs').unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

function isCaInstalledInTrustStore(): boolean {
    try {
        const { execSync } = require('child_process');
        const output = execSync('certutil -verifystore "Root" "Token Viewer Local CA"', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return output.includes('Token Viewer Local CA');
    } catch {
        return false;
    }
}

// ============================================================
// MITM 代理服务器
// ============================================================

let proxyServer: import('http').Server | undefined;
let proxyStatusBarItem: vscode.StatusBarItem | undefined;
let caMaterialGlobal: CaMaterial | undefined;
const activeProxySockets: Set<import('net').Socket> = new Set();
const domainCertCache: Map<string, CertAndKey> = new Map();

function getProxyPort(): number {
    return vscode.workspace.getConfiguration('tokenViewer').get<number>('proxyPort', 9527);
}

function startProxy(context: vscode.ExtensionContext): void {
    if (proxyServer) {
        vscode.window.showInformationMessage('代理已在运行中');
        return;
    }

    const port = getProxyPort();

    // 生成或加载 CA 证书
    const storageUri = context.globalStorageUri;
    const caCertPath = require('path').join(storageUri.fsPath, 'ca-cert.pem');
    const caKeyPath = require('path').join(storageUri.fsPath, 'ca-key.pem');

    if (require('fs').existsSync(caCertPath) && require('fs').existsSync(caKeyPath)) {
        outputChannel.appendLine('[Token Viewer] 加载已有的 CA 证书');
        const certPem = require('fs').readFileSync(caCertPath, 'utf8');
        const keyPem = require('fs').readFileSync(caKeyPath, 'utf8');
        const certDer = pemToDer(certPem);
        const tempCa = generateCaCert();
        caMaterialGlobal = { certPem, keyPem, certDer, subjectDer: tempCa.subjectDer };
    } else {
        outputChannel.appendLine('[Token Viewer] 生成新的 CA 证书');
        caMaterialGlobal = generateCaCert();
        try {
            require('fs').mkdirSync(storageUri.fsPath, { recursive: true });
            require('fs').writeFileSync(caCertPath, caMaterialGlobal.certPem);
            require('fs').writeFileSync(caKeyPath, caMaterialGlobal.keyPem);
        } catch (e) {
            outputChannel.appendLine(`[Token Viewer] 保存 CA 证书失败: ${e}`);
        }
    }

    // 安装 CA 到信任根
    const caInstalled = context.globalState.get<boolean>('tokenViewer.caInstalled');
    if (!caInstalled && !isCaInstalledInTrustStore()) {
        installCaCertToTrustStore(caMaterialGlobal.certDer).then((success) => {
            if (success) {
                context.globalState.update('tokenViewer.caInstalled', true);
                outputChannel.appendLine('[Token Viewer] CA 证书已安装到信任根存储');
            } else {
                vscode.window.showWarningMessage(
                    'CA 证书安装失败（UAC 被拒绝？）。代理仍可运行，但浏览器会显示证书警告。',
                    '重试安装'
                ).then((action) => {
                    if (action === '重试安装') {
                        installCaCertToTrustStore(caMaterialGlobal!.certDer).then((s) => {
                            if (s) { context.globalState.update('tokenViewer.caInstalled', true); }
                        });
                    }
                });
            }
        });
    }

    // 创建 HTTP 服务器
    const server = require('http').createServer();

    server.on('request', (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
        const host = req.headers.host || '';
        if (host.includes('platform.xiaomimimo.com') && req.headers.cookie) {
            onCookieCaptured(req.headers.cookie, context);
        }
        const urlObj = new URL(req.url || '/', `http://${host}`);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname + urlObj.search,
            method: req.method,
            headers: req.headers,
            agent: false,
        };
        const proxyReq = bypassSystemProxy(() => require('http').request(options, (proxyRes: import('http').IncomingMessage) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
        }));
        proxyReq.on('error', () => { res.writeHead(502); res.end(); });
        req.pipe(proxyReq);
    });

    server.on('connect', (req: import('http').IncomingMessage, clientSocket: import('net').Socket, head: Buffer) => {
        const [targetHost, targetPortStr] = (req.url || '').split(':');
        const targetPort = parseInt(targetPortStr, 10) || 443;

        if (targetHost === 'platform.xiaomimimo.com') {
            handleConnectIntercept(clientSocket, targetHost, targetPort, head, context);
        } else {
            tunnelDirect(clientSocket, targetHost, targetPort, head);
        }
    });

    server.on('error', (err: Error) => {
        if ((err as any).code === 'EADDRINUSE') {
            vscode.window.showErrorMessage(`代理端口 ${port} 被占用，请修改 tokenViewer.proxyPort 设置`);
        } else {
            outputChannel.appendLine(`[Token Viewer] 代理错误: ${err.message}`);
        }
        proxyServer = undefined;
        updateProxyStatusBar();
    });

    server.listen(port, '127.0.0.1', () => {
        proxyServer = server;
        updateProxyStatusBar();
        outputChannel.appendLine(`[Token Viewer] 代理已启动: http://127.0.0.1:${port}`);
        vscode.window.showInformationMessage(
            `代理已启动 :${port}，正在打开浏览器...`,
            '确定'
        );
        openBrowserWithProxy(port);
    });
}

function stopProxy(): void {
    for (const sock of activeProxySockets) {
        try { sock.destroy(); } catch { /* ignore */ }
    }
    activeProxySockets.clear();
    domainCertCache.clear();

    if (proxyServer) {
        proxyServer.close();
        proxyServer = undefined;
    }
    updateProxyStatusBar();
    outputChannel.appendLine('[Token Viewer] 代理已停止');
}

function tunnelDirect(clientSocket: import('net').Socket, host: string, port: number, head: Buffer): void {
    const serverSocket = bypassSystemProxy(() => require('net').connect(port, host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) { serverSocket.write(head); }
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
    }));
    serverSocket.on('error', () => { try { clientSocket.destroy(); } catch { /* ignore */ } });
    clientSocket.on('error', () => { try { serverSocket.destroy(); } catch { /* ignore */ } });
    clientSocket.on('close', () => { try { serverSocket.destroy(); } catch { /* ignore */ } });
}

function handleConnectIntercept(
    clientSocket: import('net').Socket,
    host: string, port: number, head: Buffer,
    context: vscode.ExtensionContext
): void {
    const ca = caMaterialGlobal;
    if (!ca) { tunnelDirect(clientSocket, host, port, head); return; }

    let domainCert = domainCertCache.get(host);
    if (!domainCert) {
        domainCert = generateDomainCert(host, ca);
        domainCertCache.set(host, domainCert);
    }

    const cleanup = () => {
        try { clientSocket.destroy(); } catch { /* ignore */ }
        try { serverSocket.destroy(); } catch { /* ignore */ }
        activeProxySockets.delete(clientSocket);
        activeProxySockets.delete(serverSocket);
    };

    activeProxySockets.add(clientSocket);

    const serverSocket = bypassSystemProxy(() => require('net').connect(port, host, () => {
        activeProxySockets.add(serverSocket);

        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

        const secureContext = require('tls').createSecureContext({
            key: domainCert!.keyPem,
            cert: domainCert!.certPem,
        });

        const tlsSocket = new (require('tls').TLSSocket)(clientSocket, {
            isServer: true,
            secureContext,
        });

        tlsSocket.on('error', (err: Error) => {
            outputChannel.appendLine(`[Token Viewer] TLS 错误 (${host}): ${err.message}`);
            cleanup();
        });

        let headerParsed = false;
        let requestBuffer = Buffer.alloc(0);

        tlsSocket.on('data', (data: Buffer) => {
            if (headerParsed) {
                serverSocket.write(data);
                return;
            }

            requestBuffer = Buffer.concat([requestBuffer, data]);
            const headerEnd = requestBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) { return; }

            headerParsed = true;
            const headerPart = requestBuffer.slice(0, headerEnd).toString('utf8');
            const bodyPart = requestBuffer.slice(headerEnd + 4);

            const lines = headerPart.split('\r\n');
            const [method, path, httpVersion] = lines[0].split(' ');
            const headers: Record<string, string> = {};
            for (let i = 1; i < lines.length; i++) {
                const colonIdx = lines[i].indexOf(':');
                if (colonIdx > 0) {
                    headers[lines[i].slice(0, colonIdx).trim().toLowerCase()] = lines[i].slice(colonIdx + 1).trim();
                }
            }

            if (headers['cookie']) {
                onCookieCaptured(headers['cookie'], context);
            }

            const fwdHeaders: Record<string, string> = { ...headers };
            delete fwdHeaders['proxy-connection'];
            fwdHeaders['host'] = host;

            let fwdRequest = `${method} ${path} ${httpVersion}\r\n`;
            for (const [k, v] of Object.entries(fwdHeaders)) {
                fwdRequest += `${k}: ${v}\r\n`;
            }
            fwdRequest += '\r\n';

            serverSocket.write(fwdRequest);
            if (bodyPart.length > 0) {
                serverSocket.write(bodyPart);
            }

            tlsSocket.pipe(serverSocket);
            serverSocket.pipe(tlsSocket);
        });

        serverSocket.on('error', (err: Error) => {
            outputChannel.appendLine(`[Token Viewer] 上游错误 (${host}): ${err.message}`);
            cleanup();
        });

        serverSocket.on('close', cleanup);
        tlsSocket.on('close', cleanup);
    }));

    serverSocket.on('error', (err: Error) => {
        outputChannel.appendLine(`[Token Viewer] 连接 ${host}:${port} 失败: ${err.message}`);
        try {
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        } catch { /* ignore */ }
        cleanup();
    });
}

function onCookieCaptured(cookieValue: string, context: vscode.ExtensionContext): void {
    const config = vscode.workspace.getConfiguration('tokenViewer');
    const currentHeaders = config.get<Record<string, string>>('headers', {});
    if (currentHeaders['Cookie'] === cookieValue) { return; }

    config.update('headers', { Cookie: cookieValue }, vscode.ConfigurationTarget.Global).then(() => {
        outputChannel.appendLine('[Token Viewer] Cookie 已自动捕获');
        vscode.window.showInformationMessage('Cookie 已自动捕获，正在刷新...');
        fetchTokenCount(context);
    });
}

function updateProxyStatusBar(): void {
    if (!proxyStatusBarItem) { return; }
    if (proxyServer) {
        proxyStatusBarItem.text = `$(radio-tower) Proxy: :${getProxyPort()}`;
        proxyStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        proxyStatusBarItem.command = 'tokenViewer.proxyStop';
        proxyStatusBarItem.tooltip = '代理运行中 - 点击停止';
    } else {
        proxyStatusBarItem.text = '$(circle-slash) Proxy: Off';
        proxyStatusBarItem.backgroundColor = undefined;
        proxyStatusBarItem.command = 'tokenViewer.proxyStart';
        proxyStatusBarItem.tooltip = '代理已停止 - 点击启动';
    }
}

// ============================================================
// 浏览器自动启动
// ============================================================

function findBrowserPath(): string | undefined {
    const fs = require('fs');
    const candidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) { return p; }
    }
    return undefined;
}

function openBrowserWithProxy(port: number): void {
    const browserPath = findBrowserPath();
    if (!browserPath) {
        outputChannel.appendLine('[Token Viewer] 未找到浏览器，跳过自动打开');
        return;
    }

    const { spawn } = require('child_process');
    const child = spawn(browserPath, [
        `--proxy-server=http://127.0.0.1:${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--ignore-certificate-errors',
        XIAOMI_CONFIG.loginUrl,
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    outputChannel.appendLine(`[Token Viewer] 已打开浏览器（代理 :${port}）`);
}
