export interface ICacheStrategy<T> {
    get(key: string): Promise<T | undefined>;
    set(key: string, value: T, ttl: number): Promise<boolean>;
}