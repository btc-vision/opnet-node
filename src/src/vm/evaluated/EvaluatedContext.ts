import { Context } from 'node:vm';
import { EvaluatedStack } from './EvaluatedStack.js';

export interface EvaluatedContext extends Context {
    readonly stack: EvaluatedStack;

    readonly process: null;
}
