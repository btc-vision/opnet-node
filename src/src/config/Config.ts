import path from 'path';
import { BtcIndexerConfig } from './BtcIndexerConfig.js';
import { BtcIndexerConfigManager } from './BtcIndexerConfigLoader.js';

const configPath = path.join(__dirname, '../../', 'config/btc.conf');

const configManager: BtcIndexerConfigManager = new BtcIndexerConfigManager(configPath);
export const Config: BtcIndexerConfig = configManager.getConfigs();
