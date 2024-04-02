import { ConfigurableDBManager } from '@btc-vision/motoswapdb';
import { Config } from '../config/Config.js';

export const DBManagerInstance = new ConfigurableDBManager(Config);
