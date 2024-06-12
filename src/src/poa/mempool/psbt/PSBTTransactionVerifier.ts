export class PSBTTransactionVerifier {
    constructor() {}

    public async verify(data: Uint8Array): Promise<boolean> {
        console.log(`Received psbt.`, data);

        return true;
    }
}
