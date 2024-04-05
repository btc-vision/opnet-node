import { ConfigurableDBManager } from '@btc-vision/motoswapcommon';
import { Config } from '../config/Config.js';

export const DBManagerInstance = new ConfigurableDBManager(Config);
