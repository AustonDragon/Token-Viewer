import { XiaomiPlanType } from '../types';

export interface XiaomiPlanConfig {
    id: XiaomiPlanType;
    name: string;
    apiUrl: string;
    jsonPath: string;
    totalPath: string;
    usedPath: string;
    disabled?: boolean;
}

export const XIAOMI_PLANS: XiaomiPlanConfig[] = [
    {
        id: 'cn',
        name: 'Token Plan (CN)',
        apiUrl: 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage?region=cn',
        jsonPath: 'data.usage.items[0].limit - data.usage.items[0].used',
        totalPath: 'data.usage.items[0].limit',
        usedPath: 'data.usage.items[0].used',
    },
    {
        id: 'sg',
        name: 'Token Plan (SG)',
        apiUrl: 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage?region=sg',
        jsonPath: 'data.usage.items[0].limit - data.usage.items[0].used',
        totalPath: 'data.usage.items[0].limit',
        usedPath: 'data.usage.items[0].used',
    },
    {
        id: 'balance',
        name: 'Balance',
        apiUrl: '',
        jsonPath: '',
        totalPath: '',
        usedPath: '',
        disabled: true,
    },
];

export const XIAOMI_LOGIN_URL = 'https://platform.xiaomimimo.com/console/plan-manage';
export const XIAOMI_HEADER_KEY = 'Cookie';

export function getXiaomiPlanConfig(planType: XiaomiPlanType): XiaomiPlanConfig | undefined {
    return XIAOMI_PLANS.find(p => p.id === planType);
}
