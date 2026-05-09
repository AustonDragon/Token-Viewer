export type XiaomiPlanType = 'cn' | 'sg' | 'balance';

export interface PlatformConfig {
    apiUrl: string;
    jsonPath: string;
    totalPath: string;
    usedPath: string;
    loginUrl: string;
    headerKey: string;
}

export interface TokenViewerSettings {
    headers: Record<string, string>;
    refreshInterval: number;
    alertThreshold: number;
    enableUsageNotification: boolean;
    notificationInterval: number;
    showInStatusBar: boolean;
    xiaomiPlanType: XiaomiPlanType;
}

export interface TokenData {
    remaining: number;
    total?: number;
    used?: number;
    percentage?: number;
}
