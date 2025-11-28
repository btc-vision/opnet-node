import { BinaryReader, Features } from '@btc-vision/transaction';

export class OPNetHeader {
    public static EXPECTED_HEADER_LENGTH: number = 4 + 8;
    private reader: BinaryReader;

    private readonly _priorityFeeSat: bigint;
    private readonly _headerBytes: Uint8Array;

    private _prefix: number = 0;
    private _flags: number = 0;

    constructor(
        header: Buffer,
        public readonly minerMLDSAPublicKey: Buffer,
        public readonly solution: Buffer,
    ) {
        this.reader = new BinaryReader(header);
        this._headerBytes = this.reader.readBytes(4);
        this._priorityFeeSat = this.reader.readU64();

        this.decodeHeader();
    }

    public get priorityFeeSat(): bigint {
        return this._priorityFeeSat;
    }

    public get publicKeyPrefix(): number {
        return this._prefix;
    }

    public decodeFlags(): Features[] {
        const features: Features[] = [];
        const includesAccessList =
            (this._flags & Features.ACCESS_LIST) === (Features.ACCESS_LIST as number);

        const includesEpochSubmission =
            (this._flags & Features.EPOCH_SUBMISSION) === (Features.EPOCH_SUBMISSION as number);

        const includesMLDSALinkingRequest =
            (this._flags & Features.MLDSA_LINK_PUBKEY) === (Features.MLDSA_LINK_PUBKEY as number);

        if (includesAccessList) features.push(Features.ACCESS_LIST);
        if (includesEpochSubmission) features.push(Features.EPOCH_SUBMISSION);
        if (includesMLDSALinkingRequest) features.push(Features.MLDSA_LINK_PUBKEY);

        return features;
    }

    private decodeHeader(): void {
        this._prefix = this._headerBytes[0];

        if (this._prefix !== 0x02 && this._prefix !== 0x03) {
            throw new Error('Invalid public key prefix');
        }

        const flagBuffer = Buffer.from(this._headerBytes.slice(1));
        this._flags = flagBuffer.readUIntBE(0, 3);
    }
}
