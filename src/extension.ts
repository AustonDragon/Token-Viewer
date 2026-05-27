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
let lastNotifyTime: number | undefined;
let lastNotifyToken: number | undefined;
/** 各模型上次用量快照（用于半小时报告计算差值） */
let lastModelUsage: Record<string, number> | undefined;

// ============================================================
// 激活函数 - 插件入口
// ============================================================
export function activate(context: vscode.ExtensionContext): void {
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

    // 监听配置变更
    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tokenViewer')) {
            outputChannel.appendLine('[Token Viewer] 配置已变更，重新启动定时器');
            setupTimer(context);
            fetchTokenCount(context);
        }
    });

    context.subscriptions.push(statusBarItem, outputChannel, refreshCommand, configureCommand, configChangeListener);

    // 恢复上次的 Credits
    lastTokenCount = context.globalState.get<number>('tokenViewer.lastTokenCount');
    lastNotifyTime = context.globalState.get<number>('tokenViewer.lastNotifyTime');
    lastNotifyToken = context.globalState.get<number>('tokenViewer.lastNotifyToken');

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
            lines.push(`  ${model}: ${formatCompact(e.total)} token / ${formatCompact(credits)} credits (${e.requests}次)`);
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
