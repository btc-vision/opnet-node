export interface BlockGasInformation {
    readonly blockNumber: string;
    readonly gasUsed: string;

    readonly targetGasLimit: string;
    readonly gasLimit: string;

    readonly ema: string;
    readonly baseGas: string;

    readonly gasPerSat: string;
}
