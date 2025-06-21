export type AddressCacheExport = Map<string, string>;

export class AddressCache {
    private cache: Map<string, string>;

    constructor() {
        this.cache = new Map<string, string>();
    }

    public static from(cache: AddressCacheExport): AddressCache {
        const addressCache = new AddressCache();
        addressCache.cache = cache;

        return addressCache;
    }

    public get(address: string): string | undefined {
        return this.cache.get(address);
    }

    public set(address: string, value: string): void {
        this.cache.set(address, value);
    }

    public has(address: string): boolean {
        return this.cache.has(address);
    }

    public clear(): void {
        this.cache.clear();
    }

    public export(): AddressCacheExport {
        return this.cache;
    }
}
