/**
 * @type {EvaluatedContext}
 */
const stack = context;

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

(async () => {
    stack.contract = await stack.instantiate(stack.initialBytecode, {});

    console.log('Contract instantiated');
})();
