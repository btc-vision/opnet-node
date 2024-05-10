import { Logger } from '@btc-vision/bsi-common';
import { Buffer } from 'buffer';
import fs from 'fs';
import sodium from 'sodium-native';
import { cyrb53 } from './CYRB53.js';

export class EncryptemServer extends Logger {
    public logColor: string = `#f61a3b`;

    private started: boolean = false;
    private sodium: typeof sodium = sodium;

    #serverPrivateKey: Buffer | null = null;
    #serverPublicKey: Buffer | null = null;

    #serverSignaturePublicKey: Buffer | null = null;
    #serverSignaturePrivateKey: Buffer | null = null;

    #clientSignaturePublicKey: Buffer | null = null;
    #clientPublicKey: Buffer | null = null;

    constructor() {
        super();
    }

    public destroy(): void {
        this.reset();

        this.started = false;
        this.#clientSignaturePublicKey = null;

        this.#serverSignaturePublicKey = null;
        this.#serverSignaturePrivateKey = null;

        this.#serverPublicKey = null;
        this.#serverPrivateKey = null;

        this.#clientPublicKey = null;
    }

    public setClientPublicKey(key: Buffer): void {
        this.#clientPublicKey = key;
    }

    public setClientSignaturePublicKey(key: Buffer): void {
        this.#clientSignaturePublicKey = key;
    }

    public getClientPublicKey(): Buffer | null {
        return this.#clientPublicKey;
    }

    public getClientSignaturePublicKey(): Buffer | null {
        return this.#clientSignaturePublicKey;
    }

    public getServerPublicKey(): Buffer | null {
        return this.#serverPublicKey;
    }

    public getServerSignaturePublicKey(): Buffer | null {
        return this.#serverSignaturePublicKey;
    }

    public async generateServerCipherKeyPair(): Promise<void> {
        const keys = await this.generateNewCipherKey();
        this.#serverPublicKey = keys.publicKey;
        this.#serverPrivateKey = keys.privateKey;

        const signatureSeededKeyPairs = await this.generateSignatureSeededKeyPairs(
            this.#serverPublicKey,
        );

        this.#serverSignaturePublicKey = signatureSeededKeyPairs.publicKey;
        this.#serverSignaturePrivateKey = signatureSeededKeyPairs.privateKey;
    }

    public startEncryption(): void {
        this.started = true;

        this.important(
            `!! -- Encryption started. Handshake completed successfully with client. -- !!`,
        );
    }

    public encrypt(msg: Uint8Array): Uint8Array {
        if (!this.started) {
            return msg;
        } else if (this.#clientPublicKey && this.#serverPrivateKey) {
            const encryptedBuffer = this.#encrypt(
                Buffer.from(msg),
                this.#clientPublicKey,
                this.#serverPrivateKey,
            );

            if (encryptedBuffer !== null) {
                return encryptedBuffer;
            } else {
                throw new Error('Encryption failed.');
            }
        } else {
            throw new Error('Encryption failed. Client public key or server private key is null.');
        }
    }

    public authenticateKeyData(publicKey: Uint8Array | Buffer): boolean {
        if (publicKey.length !== this.sodium.crypto_sign_PUBLICKEYBYTES) {
            return false;
        }

        publicKey = Buffer.from(publicKey as Uint8Array);

        const publicKeyName = cyrb53(publicKey.toString('hex'), publicKey[10]).toString();
        const keyName = Buffer.from(publicKeyName).toString('base64');
        const keyNamePriv = cyrb53(keyName, publicKey[12]);

        /** TODO: Change this. */
        if (fs.existsSync(`./publicKeys/${keyNamePriv}.pub`)) {
            this.log(`Public key exists. Loading key pair...`);

            const publicKey = fs.readFileSync(`./publicKeys/${keyNamePriv}.pub`, 'binary');
            this.#clientSignaturePublicKey = Buffer.from(publicKey, 'binary');

            return true;
        } else {
            this.error(`Public key ${keyNamePriv} does not exist.`);
        }

        return false;
    }

    public verifyAuth(k: Buffer, input: Buffer): boolean {
        const out = this.sodium.sodium_malloc(this.sodium.crypto_auth_BYTES);

        return this.sodium.crypto_auth_verify(out, input, k);
    }

    public decrypt(msg: Uint8Array): Uint8Array {
        if (!this.started) {
            return msg;
        } else if (
            this.#clientPublicKey &&
            this.#serverPrivateKey &&
            this.#clientSignaturePublicKey
        ) {
            const auth = Buffer.from(msg.subarray(0, this.sodium.crypto_auth_BYTES));
            const signature = Buffer.from(msg.subarray(auth.length, auth.length + 64));
            const data = Buffer.from(msg.subarray(auth.length + 64, msg.length));

            try {
                const decryptedBuffer = this.#decrypt(
                    data,
                    this.#clientPublicKey,
                    this.#serverPrivateKey,
                    signature,
                    this.#clientSignaturePublicKey,
                    auth,
                );
                if (decryptedBuffer !== null) {
                    msg = decryptedBuffer;
                }
            } catch (err: unknown) {
                const e: Error = err as Error;
                this.error(`[SERVER] Decryption failed.`);

                console.log(e);
            }

            return msg;
        } else {
            throw new Error('Decryption failed. Client public key or server private key is null.');
        }
    }

    public reset(): void {
        this.started = false;

        this.#serverPrivateKey = null;
        this.#clientPublicKey = null;
        this.#serverSignaturePublicKey = null;
        this.#serverSignaturePrivateKey = null;
        this.#serverPublicKey = null;
    }

    private generateNonce(): Buffer {
        const keyBuf = this.sodium.sodium_malloc(sodium.crypto_box_NONCEBYTES); //Buffer.alloc(this.sodium.crypto_box_NONCEBYTES);
        this.sodium.randombytes_buf(keyBuf);
        return keyBuf;
    }

    #encrypt(m: Buffer, receiverPublicKey: Buffer, senderPrivateKey: Buffer): Uint8Array | null {
        try {
            const nonce = this.generateNonce();
            const cipherMsg = this.sodium.sodium_malloc(m.length + this.sodium.crypto_box_MACBYTES);

            this.sodium.crypto_box_easy(cipherMsg, m, nonce, receiverPublicKey, senderPrivateKey);

            const finalMsg = Buffer.concat([nonce, cipherMsg]);
            const signedMessage = this.#signMessageV2(cipherMsg);

            if (signedMessage === null) {
                throw new Error(`Failed to sign message.`);
            }

            const auth = this.#authenticate(signedMessage);
            const finalMessageBuffer = Buffer.concat([auth, signedMessage, finalMsg]);

            return new Uint8Array(finalMessageBuffer);
        } catch (err: unknown) {
            const e: Error = err as Error;
            console.error(e.stack);
        }

        return null;
    }

    #decrypt(
        msg: Buffer,
        senderPublicKey: Buffer,
        receiverPrivateKey: Buffer,
        signature: Buffer,
        senderSigningPublicKey: Buffer,
        auth: Buffer,
    ): Buffer | null {
        if (msg.length < this.sodium.crypto_box_NONCEBYTES + this.sodium.crypto_box_MACBYTES) {
            throw 'Short message';
        }

        if (auth.length !== this.sodium.crypto_auth_BYTES) {
            throw 'Invalid authentication';
        }

        if (signature.length !== this.sodium.crypto_sign_BYTES) {
            throw 'Invalid signature';
        }

        const nonce = msg.subarray(0, this.sodium.crypto_box_NONCEBYTES);
        const cipher = msg.subarray(this.sodium.crypto_box_NONCEBYTES);

        const decryptedMessage = this.sodium.sodium_malloc(
            cipher.length - this.sodium.crypto_box_MACBYTES,
        );
        this.sodium.crypto_box_open_easy(
            decryptedMessage,
            cipher,
            nonce,
            senderPublicKey,
            receiverPrivateKey,
        );

        const verified = this.#verifySignature(cipher, signature, senderSigningPublicKey);
        if (verified) {
            return decryptedMessage;
        } else {
            this.error(`This message is not correctly signed. Authentication failed.`);
            return null;
        }
    }

    #authenticate(input: Buffer): Buffer {
        const out = this.sodium.sodium_malloc(this.sodium.crypto_auth_BYTES);
        const k = this.sodium.sodium_malloc(this.sodium.crypto_auth_KEYBYTES);
        this.sodium.randombytes_buf(k);

        this.sodium.crypto_auth(out, input, k);

        return out;
    }

    #verifySignature(m: Buffer, signature: Buffer, publicKey: Buffer): boolean {
        if (m !== null && m) {
            try {
                //this.sodium.crypto_sign_open(m, signature, publicKey);
                return this.sodium.crypto_sign_verify_detached(signature, m, publicKey);
            } catch (err: unknown) {
                const e: Error = err as Error;
                console.log(e.stack);
                return false;
            }
        } else {
            console.log('message is null');
            return false;
        }
    }

    #signMessageV2(m: Buffer): Buffer | null {
        if (!this.#serverSignaturePrivateKey) {
            throw new Error('Server signature private key is null.');
        }

        const signedLength = this.sodium.crypto_sign_BYTES;
        const signedMessageBuffer = this.sodium.sodium_malloc(signedLength);

        this.sodium.crypto_sign_detached(signedMessageBuffer, m, this.#serverSignaturePrivateKey);

        if (!this.#serverSignaturePublicKey) {
            return null;
        }

        const signed: boolean = this.#verifySignature(
            m,
            signedMessageBuffer,
            this.#serverSignaturePublicKey,
        );

        if (!signed) {
            return null;
        }

        return signedMessageBuffer;
    }

    private async generateSignatureSeededKeyPairs(
        seed: Buffer,
    ): Promise<{ publicKey: Buffer; privateKey: Buffer }> {
        const publicKey = this.sodium.sodium_malloc(this.sodium.crypto_sign_PUBLICKEYBYTES);
        const privateKey = this.sodium.sodium_malloc(this.sodium.crypto_sign_SECRETKEYBYTES);
        this.sodium.crypto_sign_seed_keypair(publicKey, privateKey, seed);

        return {
            publicKey,
            privateKey,
        };
    }

    private async generateNewCipherKey(): Promise<{ publicKey: Buffer; privateKey: Buffer }> {
        const publicKey = this.sodium.sodium_malloc(this.sodium.crypto_box_PUBLICKEYBYTES);
        const privateKey = this.sodium.sodium_malloc(this.sodium.crypto_box_PUBLICKEYBYTES);

        this.sodium.crypto_box_keypair(publicKey, privateKey);

        return {
            publicKey,
            privateKey,
        };
    }
}
