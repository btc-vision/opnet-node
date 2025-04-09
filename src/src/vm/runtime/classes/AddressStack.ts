import { Address } from '@btc-vision/transaction';

export class AddressStack {
    private items: Address[] = [];

    public get length(): number {
        return this.items.length;
    }

    public push(address: Address): number {
        return this.items.push(address);
    }

    public pop(): Address | undefined {
        return this.items.pop();
    }

    public peek(): Address | undefined {
        if (this.length == 0) return undefined;

        return this.items[this.length - 1];
    }

    public clear(): void {
        this.items = [];
    }

    public includes(address: Address): boolean {
        for (const item of this.items) {
            if (item.equals(address)) {
                return true;
            }
        }

        return false;
    }

    public concat(other: AddressStack): AddressStack {
        const result = new AddressStack();
        result.items = this.items.concat(other.items);
        return result;
    }

    public toString(): string {
        return this.items.toString();
    }

    *[Symbol.iterator]() {
        for (const item of this.items) {
            yield item;
        }
    }
}
