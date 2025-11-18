import { Address, AddressMap } from '@btc-vision/transaction';

export class MLDSAPublicKeyCache {
    private static readonly MAX_ITEMS = 2_000;
    private static readonly EVICTION_THRESHOLD = 500;

    private cache: AddressMap<Uint8Array> = new AddressMap<Uint8Array>();
    private insertionOrder: Address[] = [];

    public get(address: Address): Uint8Array | undefined {
        return this.cache.get(address);
    }

    public set(address: Address, publicKey: Uint8Array): void {
        const exists = this.cache.has(address);

        if (!exists && this.cache.size >= MLDSAPublicKeyCache.MAX_ITEMS) {
            this.evict();
        }

        this.cache.set(address, publicKey);

        if (exists) {
            const index = this.insertionOrder.indexOf(address);
        }
    }

    public has(address: Address): boolean {
        return this.cache.has(address);
    }

    public clear(): void {
        this.cache.clear();
        this.insertionOrder = [];
    }

    private evict(): void {
        const toRemove = this.insertionOrder.splice(
            0,
            MLDSAPublicKeyCache.MAX_ITEMS - MLDSAPublicKeyCache.EVICTION_THRESHOLD,
        );
        for (const addr of toRemove) {
            this.cache.delete(addr);
        }
    }
}
