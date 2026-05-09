import { PlatformConfig } from '../types';

export const XIAOMI_CONFIG: PlatformConfig = {
    apiUrl: 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage',
    jsonPath: 'data.usage.items[0].limit - data.usage.items[0].used',
    totalPath: 'data.usage.items[0].limit',
    usedPath: 'data.usage.items[0].used',
    loginUrl: 'https://platform.xiaomimimo.com/console/plan-manage',
    headerKey: 'Cookie',
};
