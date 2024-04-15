import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Config } from '../config/Config.js';

export const DBManagerInstance = new ConfigurableDBManager(Config);
