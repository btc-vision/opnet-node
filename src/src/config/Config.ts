import path from 'path';
import { BtcIndexerConfig } from './BtcIndexerConfig';
import { BtcIndexerConfigManager } from './BtcIndexerConfigLoader';

const configPath = path.join(__dirname, '../../', 'src/config/btc.conf');

const configManager: BtcIndexerConfigManager = new BtcIndexerConfigManager(configPath);
export const Config: BtcIndexerConfig = configManager.getConfigs();
