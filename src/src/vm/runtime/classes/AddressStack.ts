import { Address } from '@btc-vision/transaction';

export class AddressStack extends Array<Address> {
    public includes(searchElement: Address, fromIndex?: number): boolean {
        for (let i = fromIndex || 0; i < this.length; i++) {
            if (this[i].equals(searchElement)) {
                return true;
            }
        }

        return false;
    }
}
