export class GasTracker {
    #gasUsed: bigint = 0n;
    #maxGas: bigint;

    #startedAt: bigint = 0n;
    #timeSpent: bigint = 0n;

    private canTrack: boolean = true;

    constructor(private readonly MAX_GAS: bigint) {
        this.#maxGas = MAX_GAS;
    }

    public get gasUsed(): bigint {
        return this.#gasUsed;
    }

    public set maxGas(maxGas: bigint) {
        this.#maxGas = maxGas;
    }

    public get timeSpent(): bigint {
        return this.#timeSpent;
    }

    public isEnabled(): boolean {
        return this.canTrack;
    }

    public addGasUsed(gas: bigint) {
        if (!this.canTrack) {
            return;
        }

        if (gas < 0n) {
            throw new Error('Gas used cannot be negative.');
        }

        if (this.#gasUsed + gas > this.#maxGas) {
            throw new Error(`out of gas ${this.#gasUsed + gas} > ${this.#maxGas}`);
        }

        if (this.#gasUsed + gas > this.MAX_GAS) {
            throw new Error(`out of gas ${this.#gasUsed + gas} > ${this.MAX_GAS} (max)`);
        }

        this.#gasUsed += gas;
    }

    public reset(): void {
        this.#gasUsed = 0n;
        this.#maxGas = this.MAX_GAS;
        this.#timeSpent = 0n;
        this.#startedAt = 0n;
    }

    public enableTracking(cpuTimeStart: bigint): void {
        this.canTrack = true;
        this.#startedAt = cpuTimeStart;
    }

    public disableTracking(cpuStopTime: bigint): void {
        this.canTrack = false;

        this.#timeSpent += cpuStopTime - this.#startedAt;
        this.#startedAt = 0n;
    }
}
