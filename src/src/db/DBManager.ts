import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Config } from '../config/Config.js';

export const DBManagerInstance: ConfigurableDBManager = new ConfigurableDBManager(Config);
