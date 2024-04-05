import { BtcIndexerConfigManager } from '../../src/src/config/BtcIndexerConfigLoader.js';
import { BtcIndexerConfig } from '../../src/src/config/BtcIndexerConfig.js';
import path from 'path';

const configPath = path.join(__dirname, '../../', 'tests/config/btc.unit.test.conf');

const configManager: BtcIndexerConfigManager = new BtcIndexerConfigManager(configPath);
const config: BtcIndexerConfig = configManager.getConfigs();

export const TestConfig: BtcIndexerConfig = config;
