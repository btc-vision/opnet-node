import { Config } from '../config/Config.js';
import { VMManager } from './VMManager.js';

const vmManager = new VMManager(Config);
void vmManager.init();
