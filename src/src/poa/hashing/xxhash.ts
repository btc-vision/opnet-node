import xxHashModule from 'xxhash-addon';

const { XXHash128 } = xxHashModule;

export class xxHash {
    public static readonly seed: Buffer = Buffer.from([153, 58, 19, 28, 84, 182, 83, 19]);

    public static hash(data: Buffer): bigint {
        const hash = new XXHash128(xxHash.seed);
        hash.update(data);

        const buffer = hash.digest();
        return xxHash.readBigUint128LE(buffer);
    }

    public static readBigUint128LE(buffer: Buffer, offset: number = 0): bigint {
        const low = buffer.readBigUInt64LE(offset);
        const high = buffer.readBigUInt64LE(offset + 8);

        return (high << 64n) | low;
    }
}
