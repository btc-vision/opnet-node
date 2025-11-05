import { Logger } from '@btc-vision/bsi-common';
import sodium from 'sodium-native';

/** Merge client and server encryption and decryption into one class */
export class EncryptemServer extends Logger {
    public logColor: string = `#f61a3b`;

    private sodium: typeof sodium = sodium;

    #serverPrivateKey: Buffer | null = null;
    #serverPublicKey: Buffer | null = null;

    #serverSignaturePublicKey: Buffer | null = null;
    #serverSignaturePrivateKey: Buffer | null = null;

    #clientSignaturePublicKey: Buffer | null = null;
    #clientPublicKey: Buffer | null = null;

    public constructor() {
        super();
    }

    public destroy(): void {
        this.reset();

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

    public generateServerCipherKeyPair(): void {
        const keys = this.generateNewCipherKey();
        this.#serverPublicKey = keys.publicKey;
        this.#serverPrivateKey = keys.privateKey;

        const signatureSeededKeyPairs = this.generateSignatureSeededKeyPairs(keys.privateKey);

        this.#serverSignaturePublicKey = signatureSeededKeyPairs.publicKey;
        this.#serverSignaturePrivateKey = signatureSeededKeyPairs.privateKey;
    }

    public encrypt(msg: Uint8Array): Uint8Array {
        if (!(this.#clientPublicKey && this.#serverPrivateKey)) {
            throw new Error('Encryption failed. Client public key or server private key is null.');
        }

        return this.#encrypt(Buffer.from(msg), this.#clientPublicKey, this.#serverPrivateKey);
    }

    public verifyAuth(out: Buffer, input: Buffer): boolean {
        if (!this.#clientSignaturePublicKey) {
            throw new Error('Client signature public key is null.');
        }

        const k = this.sodium.sodium_malloc(this.sodium.crypto_auth_KEYBYTES);
        this.sodium.randombytes_buf_deterministic(k, this.#clientSignaturePublicKey);

        return this.sodium.crypto_auth_verify(out, input, k);
    }

    public decrypt(msg: Uint8Array): Uint8Array | null {
        if (!(this.#clientPublicKey && this.#serverPrivateKey && this.#clientSignaturePublicKey)) {
            throw new Error('Decryption failed. Client public key or server private key is null.');
        }
        const auth: Buffer = Buffer.from(msg.slice(0, this.sodium.crypto_auth_BYTES));
        const signature: Buffer = Buffer.from(msg.slice(auth.length, auth.length + 64));
        const data: Buffer = Buffer.from(msg.slice(auth.length + 64, msg.length));

        if (!this.verifyAuth(auth, signature)) {
            throw new Error('[Server] Bad AHEAD authentication.');
        }

        //try {
        return this.#decrypt(
            data,
            this.#clientPublicKey,
            this.#serverPrivateKey,
            signature,
            this.#clientSignaturePublicKey,
            auth,
        );

        //} catch {
        //this.error(`[SERVER] Decryption failed.`);
        //}
    }

    public reset(): void {
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

    #encrypt(m: Buffer, receiverPublicKey: Buffer, senderPrivateKey: Buffer): Uint8Array {
        if (!this.#serverSignaturePublicKey) {
            throw new Error('Server signature public key is null.');
        }

        const nonce = this.generateNonce();
        const cipherMsg = this.sodium.sodium_malloc(m.length + this.sodium.crypto_box_MACBYTES);

        this.sodium.crypto_box_easy(cipherMsg, m, nonce, receiverPublicKey, senderPrivateKey);

        const finalMsg = Buffer.concat([nonce, cipherMsg]);
        const signedMessage = this.#signMessageV2(cipherMsg);

        if (signedMessage === null) {
            throw new Error(`Failed to sign message.`);
        }

        const auth = this.#authenticate(signedMessage, this.#serverSignaturePublicKey);
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

    #authenticate(input: Buffer, sender: Buffer): Buffer {
        const out = this.sodium.sodium_malloc(this.sodium.crypto_auth_BYTES);
        const k = this.sodium.sodium_malloc(this.sodium.crypto_auth_KEYBYTES);
        this.sodium.randombytes_buf_deterministic(k, sender);

        this.sodium.crypto_auth(out, input, k);

        return out;
    }

    #verifySignature(m: Buffer, signature: Buffer, publicKey: Buffer): boolean {
        try {
            //this.sodium.crypto_sign_open(m, signature, publicKey);
            return this.sodium.crypto_sign_verify_detached(signature, m, publicKey);
        } catch (err: unknown) {
            return false;
        }
    }

    #signMessageV2(m: Buffer): Buffer | null {
        if (!this.#serverSignaturePrivateKey) {
            throw new Error('Server signature private key is null.');
        }

        const signedMessageBuffer = this.sodium.sodium_malloc(this.sodium.crypto_sign_BYTES);
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

    private generateSignatureSeededKeyPairs(seed: Buffer): {
        publicKey: Buffer;
        privateKey: Buffer;
    } {
        const publicKey = this.sodium.sodium_malloc(this.sodium.crypto_sign_PUBLICKEYBYTES);
        const privateKey = this.sodium.sodium_malloc(this.sodium.crypto_sign_SECRETKEYBYTES);
        this.sodium.crypto_sign_seed_keypair(publicKey, privateKey, seed);

        return {
            publicKey,
            privateKey,
        };
    }

    private generateNewCipherKey(): { publicKey: Buffer; privateKey: Buffer } {
        const publicKey = this.sodium.sodium_malloc(this.sodium.crypto_box_PUBLICKEYBYTES);
        const privateKey = this.sodium.sodium_malloc(this.sodium.crypto_box_SECRETKEYBYTES);

        this.sodium.crypto_box_keypair(publicKey, privateKey);

        return {
            publicKey,
            privateKey,
        };
    }
}
