const stack = context;

const console = {
    log: (...args) => {
        if (args.length === 1 && typeof args[0] !== 'string') {
            stack.logs.push(args[0]);
        } else {
            stack.logs.push(args.join(' '));
        }
    },
    error: (...args) => {
        stack.errors.push(args.join(' '));
    },
};

const contract = new stack.ContractEvaluator(stack, console);
(async () => {
    await contract.init();

    contract.export();
})();
