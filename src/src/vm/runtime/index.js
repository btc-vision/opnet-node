/**
 * @type {EvaluatedContext}
 */
const stack = _stack;

stack.logs = [];
stack.errors = [];

const console = {
    log: (...args) => {
        stack.logs.push(args.join(' '));
    },
    error: (...args) => {
        stack.errors.push(args.join(' '));
    },
};

console.log(stack.initialBytecode);
