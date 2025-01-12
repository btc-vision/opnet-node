import { fileURLToPath } from 'node:url';
import path from 'path';

import '../promise/promise.safeAll.js';

if (!globalThis['__filename'] && !process.env.TS_JEST) {
    const __filename = fileURLToPath(import.meta.url);
    global.__filename = __filename;

    if (!globalThis['__dirname']) {
        global.__dirname = path.dirname(__filename);
    }
}
