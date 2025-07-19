import crypto from 'crypto';

export class SHA1 {
    public static hash(data: Buffer): string {
        return crypto.createHash('sha1').update(data).digest('hex');
    }
}
