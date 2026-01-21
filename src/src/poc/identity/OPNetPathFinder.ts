import fs from 'fs';
import path from 'path';
import { Config } from '../../config/Config.js';

export class OPNetPathFinder {
    private readonly baseKey: Uint8Array = new Uint8Array([
        38, 162, 193, 94, 65, 16, 221, 161, 9, 147, 108, 244, 141, 120, 43, 48, 170, 11, 60, 155,
        22, 66, 236, 123, 132, 192, 47, 24, 144, 19, 76, 237,
    ]);

    private encKey: Uint8Array = this.baseKey;
    private textDecoder: TextDecoder = new TextDecoder();

    constructor(derivateKey?: Uint8Array) {
        this.deriveKey(derivateKey);
        this.createBinFolder();
    }

    protected getBinPath(): string {
        return path.join(
            __dirname,
            '../../',
            `bin-${Config.BITCOIN.NETWORK}-${Config.BITCOIN.CHAIN_ID}`,
        );
    }

    protected encrypt(dataJson: string): Uint8Array {
        const data: string = Buffer.from(dataJson).toString('base64');

        return this.encryptRaw(Buffer.from(data, 'utf8'));
    }

    protected encryptRaw(data: Uint8Array | Buffer): Uint8Array {
        const encrypted: Uint8Array = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            encrypted[i] = data[i] ^ this.encKey[i % this.encKey.byteLength];
        }

        return encrypted;
    }

    protected decrypt(encrypted: Uint8Array | Buffer): Uint8Array {
        const data: Uint8Array = new Uint8Array(encrypted.byteLength);
        for (let i = 0; i < encrypted.byteLength; i++) {
            data[i] = encrypted[i] ^ this.encKey[i % this.encKey.byteLength];
        }

        return data;
    }

    protected decryptToString(encrypted: Uint8Array): string {
        const decrypted = this.decrypt(encrypted);
        const decoded = this.textDecoder.decode(decrypted);

        return Buffer.from(decoded, 'base64').toString('utf8');
    }

    protected deriveKey(derivateKey?: Uint8Array): void {
        if (derivateKey) {
            this.encKey = new Uint8Array(derivateKey.length);

            for (let i = 0; i < derivateKey.length; i++) {
                this.encKey[i] = derivateKey[i] ^ this.baseKey[i % this.baseKey.length];
            }
        }
    }

    private createBinFolder(): void {
        const binPath = this.getBinPath();
        if (!fs.existsSync(binPath)) {
            fs.mkdirSync(binPath);
        }
    }
}
