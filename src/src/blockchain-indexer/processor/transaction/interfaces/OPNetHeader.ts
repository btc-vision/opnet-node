export class OPNetHeader {
    constructor(
        public readonly headerBytes: Buffer,
        public readonly preimage: Buffer,
    ) {}

    public get publicKeyPrefix(): number {
        const prefix = this.headerBytes[0];

        // we only allow compressed public keys.
        if (prefix === 0x02 || prefix === 0x03) {
            return prefix;
        }

        throw new Error('Invalid public key prefix');
    }
}
