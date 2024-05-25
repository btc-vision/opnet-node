export class GasTracker {
    #gasUsed: bigint = 0n;

    private canTrack: boolean = false;

    constructor() {}

    public get gasUsed(): bigint {
        return this.#gasUsed;
    }

    public set gasUsed(gas: bigint) {
        if (!this.canTrack) {
            return;
        }

        this.#gasUsed = gas;
    }

    public async track<T = void>(fn: () => Promise<T> | T): Promise<T> {
        this.enableTracking();

        let resp: Awaited<T> = await fn();
        this.disableTracking();

        return resp;
    }

    public reset(): void {
        this.#gasUsed = 0n;
    }

    public enableTracking(): void {
        this.canTrack = true;
    }

    public disableTracking(): void {
        this.canTrack = false;
    }
}
