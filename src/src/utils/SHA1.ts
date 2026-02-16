import crypto from 'crypto';

export class SHA1 {
    public static hash(data: Uint8Array): string {
        return crypto.createHash('sha1').update(data).digest('hex');
    }

    public static hashBuffer(data: Uint8Array): Uint8Array {
        const digest = crypto.createHash('sha1').update(data).digest();
        return new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength);
    }
}
