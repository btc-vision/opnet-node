import { BinaryReader, FeaturePriority, Features } from '@btc-vision/transaction';

export interface PriorityOrder {
    priority: FeaturePriority;
    feature: Features;
}

export class OPNetHeader {
    public static EXPECTED_HEADER_LENGTH: number = 4 + 8;
    private reader: BinaryReader;

    private readonly _priorityFeeSat: bigint;
    private readonly _headerBytes: Uint8Array;

    private _prefix: number = 0;
    private _flags: number = 0;

    constructor(
        header: Uint8Array,
        public readonly minerMLDSAPublicKey: Uint8Array,
        public readonly solution: Uint8Array,
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

    public decodeFlags(): PriorityOrder[] {
        const features: PriorityOrder[] = [];
        const includesAccessList =
            (this._flags & Features.ACCESS_LIST) === (Features.ACCESS_LIST as number);

        const includesEpochSubmission =
            (this._flags & Features.EPOCH_SUBMISSION) === (Features.EPOCH_SUBMISSION as number);

        const includesMLDSALinkingRequest =
            (this._flags & Features.MLDSA_LINK_PUBKEY) === (Features.MLDSA_LINK_PUBKEY as number);

        if (includesAccessList) {
            features.push({
                priority: FeaturePriority.ACCESS_LIST,
                feature: Features.ACCESS_LIST,
            });
        }

        if (includesEpochSubmission) {
            features.push({
                priority: FeaturePriority.EPOCH_SUBMISSION,
                feature: Features.EPOCH_SUBMISSION,
            });
        }

        if (includesMLDSALinkingRequest) {
            features.push({
                priority: FeaturePriority.MLDSA_LINK_PUBKEY,
                feature: Features.MLDSA_LINK_PUBKEY,
            });
        }

        return features;
    }

    private decodeHeader(): void {
        this._prefix = this._headerBytes[0];

        if (this._prefix !== 0x02 && this._prefix !== 0x03) {
            throw new Error('Invalid public key prefix');
        }

        // Read 3-byte big-endian unsigned integer from bytes [1..3]
        this._flags =
            (this._headerBytes[1] << 16) |
            (this._headerBytes[2] << 8) |
            this._headerBytes[3];
    }
}
