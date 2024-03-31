import { Config } from '../config/Config.js';

export class CBRCDistributionHelper {
    public static getBaseBlockFromCurrentHeight(currentBlockHeight: number): number {
        const MRC_DISTRIBUTION_PERIOD = Config.getDistributionPeriod();

        const base =
            Math.floor(currentBlockHeight / MRC_DISTRIBUTION_PERIOD) * MRC_DISTRIBUTION_PERIOD;

        if (isNaN(base)) {
            // !!!TODO: log error
            return 0;
        }

        return base;
    }
    
    public static getDistBlockFromCurrentHeight(currentBlockHeight: number): number {
        const MRC_DISTRIBUTION_PERIOD = Config.getDistributionPeriod();

        const dist =
            Math.ceil(currentBlockHeight / MRC_DISTRIBUTION_PERIOD) * MRC_DISTRIBUTION_PERIOD;

        if (isNaN(dist)) {
            // TODO: log error
            return 0;
        }

        return dist;
    }
}
