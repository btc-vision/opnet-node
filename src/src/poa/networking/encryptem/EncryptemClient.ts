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

    constructor() {
        super();
    }

    public setClientSecretKey(key: Buffer): void {
        this.#clientSecretKey = key;
    }

    public setClientPublicKey(key: Buffer): void {
        this.#clientPublicKey = key;
    }

    public setClientSignaturePublicKey(key: Buffer): void {
        this.#clientSignaturePublicKey = key;
    }

    public setClientSignaturePrivateKey(key: Buffer): void {
        this.#clientSignaturePrivateKey = key;
    }

    public setServerSignaturePublicKey(key: Buffer): void {
        this.#serverSignaturePublicKey = key;
    }

    public setServerPublicKey(key: Buffer): void {
        this.#serverPublicKey = key;
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

    public async generateClientCipherKeyPair(authKey: Uint8Array): Promise<boolean> {
        const keys = await this.generateNewCipherKey();

        this.setClientPublicKey(keys.publicKey);
        this.setClientSecretKey(keys.privateKey);

        const signatureSeededKeyPairs = await this.generateSignatureSeededKeyPairs(authKey);
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
            Buffer.from(msg),
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
        let auth = Buffer.from(msg.slice(0, this.sodium.crypto_auth_BYTES));
        let signature = Buffer.from(msg.slice(auth.length, auth.length + 64));
        let data = Buffer.from(msg.slice(auth.length + 64, msg.length));

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

    public verifyAuth(out: Buffer, input: Buffer): boolean {
        if (!this.#serverSignaturePublicKey) {
            throw new Error('Client signature public key is null.');
        }

        const k = this.sodium.sodium_malloc(this.sodium.crypto_auth_KEYBYTES);
        this.sodium.randombytes_buf_deterministic(k, this.#serverSignaturePublicKey);

        return this.sodium.crypto_auth_verify(out, input, k);
    }

    private async generateNewCipherKey(): Promise<{
        publicKey: Buffer;
        privateKey: Buffer;
    }> {
        let publicKey = this.sodium.sodium_malloc(this.sodium.crypto_box_PUBLICKEYBYTES);
        let privateKey = this.sodium.sodium_malloc(this.sodium.crypto_box_PUBLICKEYBYTES);

        this.sodium.crypto_box_keypair(publicKey, privateKey);

        return {
            publicKey,
            privateKey,
        };
    }

    private generateNonce(): Buffer {
        let keyBuf = this.sodium.sodium_malloc(this.sodium.crypto_box_NONCEBYTES);
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
        let nonce = this.generateNonce();
        let cipherMsg = this.sodium.sodium_malloc(m.length + this.sodium.crypto_box_MACBYTES);

        this.sodium.crypto_box_easy(cipherMsg, m, nonce, receiverPublicKey, senderPrivateKey);

        let finalMsg = Buffer.concat([nonce, cipherMsg]);
        let signedMessage = this.#signMessageV2(
            cipherMsg,
            senderPublicKey,
            senderSigningPrivateKey,
        );
        if (signedMessage === null) {
            throw new Error(`Failed to sign message.`);
        }

        let auth = this.#authenticate(signedMessage, senderPublicKey);
        let finalMessageBuffer = Buffer.concat([auth, signedMessage, finalMsg]);

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

        let verified = this.#verifySignature(cipher, signature, senderSigningPublicKey);
        if (!verified) {
            throw new Error('Invalid signature');
        }
        return decryptedMessage;
    }

    #authenticate(input: Buffer, sender: Buffer): Buffer {
        let out = this.sodium.sodium_malloc(this.sodium.crypto_auth_BYTES);
        let k = this.sodium.sodium_malloc(this.sodium.crypto_auth_KEYBYTES);
        this.sodium.randombytes_buf_deterministic(k, sender);

        this.sodium.crypto_auth(out, input, k);

        return out;
    }

    #verifySignature(m: Buffer, signature: Buffer, publicKey: Buffer): boolean {
        if (m !== null && m) {
            try {
                let signed = this.sodium.crypto_sign_verify_detached(signature, m, publicKey); //this.sodium.crypto_sign_open(m, signature, publicKey);

                return signed;
            } catch (e) {
                return false;
            }
        } else {
            return false;
        }
    }

    #signMessageV2(m: Buffer, publicSignKey: Buffer, privateKey: Buffer): Buffer | null {
        const signedLength = this.sodium.crypto_sign_BYTES;
        const signedMessageBuffer = this.sodium.sodium_malloc(signedLength);

        this.sodium.crypto_sign_detached(signedMessageBuffer, m, privateKey);

        let signed: boolean = this.#verifySignature(m, signedMessageBuffer, publicSignKey);
        if (!signed) {
            return null;
        }

        return signedMessageBuffer;
    }

    #signMessage(m: Buffer, publicSignKey: Buffer, privateSigningKey: Buffer): Buffer | null {
        let MESSAGE_LEN = m.length;
        let signedLength = this.sodium.crypto_sign_BYTES + MESSAGE_LEN;
        let signedMessageBuffer = this.sodium.sodium_malloc(signedLength);

        this.sodium.crypto_sign(signedMessageBuffer, m, privateSigningKey);

        let signed = this.#verifySignature(m, signedMessageBuffer, publicSignKey);
        if (!signed) {
            return null;
        } else {
            return signedMessageBuffer;
        }
    }

    private async generateSignatureSeededKeyPairs(authKey: Uint8Array): Promise<{
        publicKey: Buffer;
        privateKey: Buffer;
    }> {
        const privateKey = authKey.slice(0, 64);
        const publicKey = authKey.slice(64, 96);

        return {
            publicKey: Buffer.from(publicKey.buffer),
            privateKey: Buffer.from(privateKey.buffer),
        };
    }
}
