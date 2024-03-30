import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

global.__filename = __filename;
global.__dirname = __dirname;

// @ts-ignore
BigInt.prototype.toJSON = function () {
    return this.toString();
};

global.BigInt = BigInt;

export class Globals {
    public static register(): void {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

        process.on('uncaughtException', (err: Error) => {
            if (!err.stack) return;
            if (err.stack.includes('invalid address')) return;
            if (err.stack.includes('null: value out of range')) return;
            //if(err.stack.includes('invalid request')) return;
            console.log('Thread Caught exception: ', err.stack);
        });

        process.emitWarning = (warning: string, ...args: any[]) => {
            if (args[0] === 'ExperimentalWarning') {
                return;
            }

            if (args[0] && typeof args[0] === 'object' && args[0].type === 'ExperimentalWarning') {
                return;
            } else {
                console.log(warning);
            }

            //return emitWarning(warning, ...args);
        };
    }
}
