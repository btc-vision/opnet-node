import { Logger } from '@btc-vision/bsi-common';

import sodium from 'sodium-native';

/** TODO: MERGE CLIENT AND SERVER ENCRYPTEM INTO ONE CLASS */
export class EncryptemClient extends Logger {
    public readonly logColor: string = `#1af69a`;

    private sodium: typeof sodium = sodium;

    #clientSecretKey: Buffer | null = null;
    #clientPublicKey: Buffer | null = null;

    #clientSignaturePublicKey: Buffer | null = null;
    #clientSignaturePrivateKey: Buffer | null = null;

    #serverPublicKey: Buffer | null = null;
    #serverSignaturePublicKey: Buffer | null = null;

    public constructor() {
        super();
    }

    public setClientSecretKey(key: Uint8Array): void {
        this.#clientSecretKey = Buffer.from(key.buffer, key.byteOffset, key.byteLength);
    }

    public setClientPublicKey(key: Uint8Array): void {
        this.#clientPublicKey = Buffer.from(key.buffer, key.byteOffset, key.byteLength);
    }

    public setClientSignaturePublicKey(key: Uint8Array): void {
        this.#clientSignaturePublicKey = Buffer.from(key.buffer, key.byteOffset, key.byteLength);
    }

    public setClientSignaturePrivateKey(key: Uint8Array): void {
        this.#clientSignaturePrivateKey = Buffer.from(key.buffer, key.byteOffset, key.byteLength);
    }

    public setServerSignaturePublicKey(key: Uint8Array): void {
        this.#serverSignaturePublicKey = Buffer.from(key.buffer, key.byteOffset, key.byteLength);
    }

    public setServerPublicKey(key: Uint8Array): void {
        this.#serverPublicKey = Buffer.from(key.buffer, key.byteOffset, key.byteLength);
    }

    public getClientPublicKey(): Uint8Array | null {
        return this.#clientPublicKey;
    }

    public getClientSignaturePublicKey(): Uint8Array | null {
        return this.#clientSignaturePublicKey;
    }

    public getServerPublicKey(): Uint8Array | null {
        return this.#serverPublicKey;
    }

    public getServerSignaturePublicKey(): Uint8Array | null {
        return this.#serverSignaturePublicKey;
    }

    public generateClientCipherKeyPair(authKey: Uint8Array): boolean {
        const keys = this.generateNewCipherKey();

        this.setClientPublicKey(keys.publicKey);
        this.setClientSecretKey(keys.privateKey);

        const signatureSeededKeyPairs = this.generateSignatureSeededKeyPairs(authKey);
        this.#clientSignaturePublicKey = signatureSeededKeyPairs.publicKey;
        this.#clientSignaturePrivateKey = signatureSeededKeyPairs.privateKey;

        this.#serverSignaturePublicKey = null;

        return !(
            keys.privateKey.length !== 32 ||
            keys.publicKey.length !== 32 ||
            signatureSeededKeyPairs.publicKey.length !== 32 ||
            signatureSeededKeyPairs.privateKey.length !== 64
        );
    }

    public encrypt(msg: Uint8Array): Uint8Array {
        if (
            !(
                this.#serverPublicKey &&
                this.#clientSecretKey &&
                this.#clientSignaturePublicKey &&
                this.#clientSignaturePrivateKey
            )
        ) {
            throw new Error('One of the client key is null.');
        }
        return this.#encrypt(
            Buffer.from(msg.buffer, msg.byteOffset, msg.byteLength),
            this.#serverPublicKey,
            this.#clientSecretKey,
            this.#clientSignaturePublicKey,
            this.#clientSignaturePrivateKey,
        );
    }

    public decrypt(msg: Uint8Array): Uint8Array {
        if (!(this.#serverPublicKey && this.#clientSecretKey && this.#serverSignaturePublicKey)) {
            throw new Error('One of the client key is null.');
        }
        const authSlice = msg.slice(0, this.sodium.crypto_auth_BYTES);
        const auth = Buffer.from(authSlice.buffer, authSlice.byteOffset, authSlice.byteLength);
        const sigSlice = msg.slice(auth.length, auth.length + 64);
        const signature = Buffer.from(sigSlice.buffer, sigSlice.byteOffset, sigSlice.byteLength);
        const dataSlice = msg.slice(auth.length + 64, msg.length);
        const data = Buffer.from(dataSlice.buffer, dataSlice.byteOffset, dataSlice.byteLength);

        return this.#decrypt(
            data,
            this.#serverPublicKey,
            this.#clientSecretKey,
            signature,
            this.#serverSignaturePublicKey,
            auth,
        );
    }

    public destroy(): void {
        this.#clientSecretKey = null;
        this.#clientPublicKey = null;

        this.#clientSignaturePublicKey = null;
        this.#clientSignaturePrivateKey = null;

        this.#serverPublicKey = null;
        this.#serverSignaturePublicKey = null;
    }

    public verifyAuth(out: Uint8Array, input: Uint8Array): boolean {
        if (!this.#serverSignaturePublicKey) {
            throw new Error('Client signature public key is null.');
        }

        const outBuf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
        const inputBuf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        const k = this.sodium.sodium_malloc(this.sodium.crypto_auth_KEYBYTES);
        this.sodium.randombytes_buf_deterministic(k, this.#serverSignaturePublicKey);

        return this.sodium.crypto_auth_verify(outBuf, inputBuf, k);
    }

    private generateNewCipherKey(): {
        publicKey: Buffer;
        privateKey: Buffer;
    } {
        const publicKey = this.sodium.sodium_malloc(this.sodium.crypto_box_PUBLICKEYBYTES);
        const privateKey = this.sodium.sodium_malloc(this.sodium.crypto_box_SECRETKEYBYTES);

        this.sodium.crypto_box_keypair(publicKey, privateKey);

        return {
            publicKey,
            privateKey,
        };
    }

    private generateNonce(): Buffer {
        const keyBuf = this.sodium.sodium_malloc(this.sodium.crypto_box_NONCEBYTES);
        this.sodium.randombytes_buf(keyBuf);
        return keyBuf;
    }

    #encrypt(
        m: Buffer,
        receiverPublicKey: Buffer,
        senderPrivateKey: Buffer,
        senderPublicKey: Buffer,
        senderSigningPrivateKey: Buffer,
    ): Uint8Array {
        const nonce = this.generateNonce();
        const cipherMsg = this.sodium.sodium_malloc(m.length + this.sodium.crypto_box_MACBYTES);

        this.sodium.crypto_box_easy(cipherMsg, m, nonce, receiverPublicKey, senderPrivateKey);

        const finalMsg = Buffer.concat([nonce, cipherMsg]);
        const signedMessage = this.#signMessageV2(
            cipherMsg,
            senderPublicKey,
            senderSigningPrivateKey,
        );
        if (signedMessage === null) {
            throw new Error(`Failed to sign message.`);
        }

        const auth = this.#authenticate(signedMessage, senderPublicKey);
        const finalMessageBuffer = Buffer.concat([auth, signedMessage, finalMsg]);

        return new Uint8Array(finalMessageBuffer);
    }

    #decrypt(
        msg: Buffer,
        senderPublicKey: Buffer,
        receiverPrivateKey: Buffer,
        signature: Buffer,
        senderSigningPublicKey: Buffer,
        auth: Buffer,
    ): Buffer {
        if (msg.length < this.sodium.crypto_box_NONCEBYTES + this.sodium.crypto_box_MACBYTES) {
            throw new Error('Short message');
        }

        const nonce: Buffer = msg.subarray(0, this.sodium.crypto_box_NONCEBYTES);
        const cipher: Buffer = msg.subarray(this.sodium.crypto_box_NONCEBYTES);

        const decryptedMessage = this.sodium.sodium_malloc(
            cipher.length - this.sodium.crypto_box_MACBYTES,
        );

        if (!this.verifyAuth(auth, signature)) {
            throw new Error('[Client] Bad AHEAD authentication.');
        }

        this.sodium.crypto_box_open_easy(
            decryptedMessage,
            cipher,
            nonce,
            senderPublicKey,
            receiverPrivateKey,
        );

        const verified = this.#verifySignature(cipher, signature, senderSigningPublicKey);
        if (!verified) {
            throw new Error('Invalid signature');
        }
        return decryptedMessage;
    }

    #authenticate(input: Buffer, sender: Buffer): Buffer {
        const out = this.sodium.sodium_malloc(this.sodium.crypto_auth_BYTES);
        const k = this.sodium.sodium_malloc(this.sodium.crypto_auth_KEYBYTES);
        this.sodium.randombytes_buf_deterministic(k, sender);

        this.sodium.crypto_auth(out, input, k);

        return out;
    }

    #verifySignature(m: Buffer, signature: Buffer, publicKey: Buffer): boolean {
        if (m !== null && m) {
            try {
                return this.sodium.crypto_sign_verify_detached(signature, m, publicKey);
            } catch {
                return false;
            }
        } else {
            return false;
        }
    }

    #signMessageV2(m: Buffer, publicSignKey: Buffer, privateKey: Buffer): Buffer | null {
        const signedMessageBuffer = this.sodium.sodium_malloc(this.sodium.crypto_sign_BYTES);

        this.sodium.crypto_sign_detached(signedMessageBuffer, m, privateKey);

        const signed: boolean = this.#verifySignature(m, signedMessageBuffer, publicSignKey);
        if (!signed) {
            return null;
        }

        return signedMessageBuffer;
    }

    private generateSignatureSeededKeyPairs(authKey: Uint8Array): {
        publicKey: Buffer;
        privateKey: Buffer;
    } {
        const privateKey = authKey.slice(0, 64);
        const publicKey = authKey.slice(64, 96);

        return {
            publicKey: Buffer.from(publicKey.buffer, publicKey.byteOffset, publicKey.byteLength),
            privateKey: Buffer.from(privateKey.buffer, privateKey.byteOffset, privateKey.byteLength),
        };
    }
}
