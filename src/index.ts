import { Core } from './src/Core.js';

if (process.argv[2] !== 'child') {
    new Core();
}
