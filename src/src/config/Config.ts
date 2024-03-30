import { ConfigBase } from './ConfigBase.js';
import { ConfigManager } from './ConfigLoader.js';

const configManager: ConfigManager = new ConfigManager();
const config: ConfigBase = configManager.getConfigs();

export const Config: ConfigBase = config;
