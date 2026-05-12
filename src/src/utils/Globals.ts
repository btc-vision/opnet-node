import fs from 'fs';
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

// Process-wide fatal handlers. Installed once per process (main, every worker
// thread, every forked sub-worker). Persist the stack so post-mortem doesn't
// rely on stdout scrollback, then exit non-zero so the supervisor (Threader,
// RPCSubWorkerManager, PluginWorkerThread) can respawn a clean instance.
//
// Guarded against double-install in case Globals.js is loaded twice (e.g. via
// different specifier paths).
if (!(globalThis as { __opnetFatalInstalled?: boolean }).__opnetFatalInstalled) {
    (globalThis as { __opnetFatalInstalled?: boolean }).__opnetFatalInstalled = true;

    const writeFatal = (
        kind: 'uncaughtException' | 'unhandledRejection',
        err: unknown,
    ): void => {
        const stack =
            err instanceof Error
                ? (err.stack ?? err.message)
                : (() => {
                      try {
                          return JSON.stringify(err);
                      } catch {
                          return String(err);
                      }
                  })();

        const line = `${new Date().toISOString()} [pid=${process.pid}] ${kind}: ${stack}\n`;

        try {
            fs.appendFileSync('uncaught-exception.log', line);
        } catch {
            // disk gone — nothing useful to do.
        }

        try {
            process.stderr.write(line);
        } catch {
            // already on the way out.
        }
    };

    process.on('uncaughtException', (error) => {
        writeFatal('uncaughtException', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        writeFatal('unhandledRejection', reason);
        process.exit(1);
    });
}
