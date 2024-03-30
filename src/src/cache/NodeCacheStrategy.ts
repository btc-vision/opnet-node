import { ICacheStrategy } from './interfaces/ICacheStrategy.js';
import NodeCache from 'node-cache';

class NodeCacheStrategy<T> implements ICacheStrategy<T> {
    private maxItems: number = 0;
    private cache: NodeCache;

    constructor(maxItems:number = 1024) {
        this.cache = new NodeCache();
        this.maxItems = maxItems;

        this.cache.on("expired", (key, value) => {
            
            
        });
    }

    public async get(key: string): Promise<T | undefined> {
        return this.cache.get(key);
    }

    public async set(key: string, value: T, ttl: number = 0): Promise<boolean> {
        if (this.cache.keys().length > this.maxItems) {
            const firstKey = this.cache.keys()[0];
            this.cache.del(firstKey);
        }

        return this.cache.set(key, value, ttl);
    }
}