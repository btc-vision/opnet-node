import config from './config/Config.js'

class CBRCDistributionHelper {
    constructor() {

    }

    static getBaseBlockFromCurrentHeight(currentBlockHeight) {
        const MRC_DISTRIBUTION_PERIOD = config.getDistributionPeriod();

        const base =
            Math.floor(currentBlockHeight / MRC_DISTRIBUTION_PERIOD) *
            MRC_DISTRIBUTION_PERIOD;

        if (isNaN(base)) {
            // !!!TODO: log error
            return 0;
        }

        return base;
    }

    static getDistBlockFromCurrentHeight(currentBlockHeight) {
        const MRC_DISTRIBUTION_PERIOD = config.getDistributionPeriod();

        const dist =
            Math.ceil(currentBlockHeight / MRC_DISTRIBUTION_PERIOD) *
            MRC_DISTRIBUTION_PERIOD;

        if (isNaN(dist)) {
            // TODO: log error
            return 0;
        }

        return dist;
    }
}

export { CBRCDistributionHelper }