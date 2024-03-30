import { Config } from '../../config/Config.js';
import { ThreaderConfigurations } from '../../threading/interfaces/ThreaderConfigurations.js';

enum Services {
    API = 'API',
}

export const ServicesConfigurations: { [key in Services]: ThreaderConfigurations } = {
    API: {
        maxInstance: Config.API.THREADS,
        target: './src/api/ServerThread.js',
    },
};
