import { BinaryReader } from '@btc-vision/transaction';

export class OPNetHeader {
    public static EXPECTED_HEADER_LENGTH: number = 4 + 8;
    private reader: BinaryReader;
    private readonly _priorityFeeSat: bigint;
    private readonly _headerBytes: Uint8Array;

    constructor(
        header: Buffer,
        public readonly preimage: Buffer,
    ) {
        this.reader = new BinaryReader(header);
        this._headerBytes = this.reader.readBytes(4);
        this._priorityFeeSat = this.reader.readU64();
    }

    public get priorityFeeSat(): bigint {
        return this._priorityFeeSat;
    }

    public get publicKeyPrefix(): number {
        const prefix = this._headerBytes[0];

        // we only allow compressed public keys.
        if (prefix === 0x02 || prefix === 0x03) {
            return prefix;
        }

        throw new Error('Invalid public key prefix');
    }
}
