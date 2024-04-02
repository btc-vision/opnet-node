import { ConfigBase, ConfigManager } from '@btc-vision/motoswapcommon';
import path from 'path';

const configPath = path.join(__dirname, '../../', 'src/config/btc.conf');

const configManager: ConfigManager<ConfigBase> = new ConfigManager(configPath);
const config: ConfigBase = configManager.getConfigs();

export const Config: ConfigBase = config;
