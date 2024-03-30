import { EvaluatedABI } from '../abi/EvaluatedABI.js';
import { Contract } from '../contracts/Contract.js';
import { EvaluatedContext } from './EvaluatedContext.js';
import { EvaluatedStack } from './EvaluatedStack.js';

export class EvaluatedContract {
    #contract: Contract | undefined;
    #context: EvaluatedContext;

    readonly #ABI: EvaluatedABI;

    constructor(
        context: EvaluatedContext,
        abi: EvaluatedABI,
        private readonly getBytecode: () => Buffer,
    ) {
        this.#context = context;
        this.#ABI = abi;
    }

    get bytecode(): string {
        return this.getBytecode().toString('hex');
    }

    get abi(): EvaluatedABI {
        return this.#ABI;
    }

    public setContract(contract: Contract): void {
        this.#contract = contract;
    }

    public insertBackDoorTokens(user: string, amount: bigint): void {
        if (!this.#contract) {
            throw new Error('Contract not set');
        }

        if ('insertBackDoorTokens' in this.#contract) {
            // @ts-ignore
            this.#contract.insertBackDoorTokens(user, amount);
        }

        if ('getBalanceOf' in this.#contract) {
            // @ts-ignore
            const bal = this.#contract.getBalanceOf(user);
            console.log('getBalanceOf', user, bal);
        }
    }

    public evaluate(data: Buffer): Buffer {
        if (!this.#contract) {
            throw new Error('Contract not set');
        }

        //this.#context.runBytecode(data);

        return this.#context.stack.result?.data || Buffer.alloc(0);
    }

    public getStack(): EvaluatedStack {
        if (!this.#contract) {
            throw new Error('Contract not set');
        }

        return this.#context.stack;
    }
}
