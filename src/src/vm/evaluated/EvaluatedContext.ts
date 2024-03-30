import { Context } from 'node:vm';
import { EvaluatedStack } from './EvaluatedStack.js';

export interface EvaluatedContext extends Context {
    readonly context: {
        readonly stack: EvaluatedStack;

        getStorage: (address: string, pointer: Buffer) => Buffer;
        setStorage: (address: string, pointer: Buffer, value: Buffer) => void;

        initialBytecode: Buffer;
    };
}
