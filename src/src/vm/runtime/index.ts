import { EvaluatedContext } from '../evaluated/EvaluatedContext.js';

declare const stack: EvaluatedContext;

stack.logs = [];
stack.errors = [];

const console = {
    log: (...args: string[]) => {
        stack.logs.push(args.join(' '));
    },
    error: (...args: string[]) => {
        stack.errors.push(args.join(' '));
    },
};
