import { ScriptSig, VIn } from '@btc-vision/bsi-bitcoin-rpc';
import { Binary } from 'mongodb';

export interface TransactionInputBase {
    readonly originalTransactionId: string | undefined;
    readonly outputTransactionIndex: number | undefined; // consumer output index

    readonly scriptSignature?: ScriptSig;
    readonly sequenceId: number;

    readonly transactionInWitness: string[];
}

export interface ITransactionInput extends TransactionInputBase {
    pubKey?: Binary;
    pubKeyHash?: Binary;
}

export interface APIDocumentInput extends TransactionInputBase {
    pubKey?: string;
    pubKeyHash?: string;
}

export class TransactionInput implements TransactionInputBase {
    public readonly originalTransactionId: string | undefined;
    public readonly outputTransactionIndex: number | undefined; // consumer output index

    public readonly scriptSignature: ScriptSig | undefined;
    public readonly sequenceId: number;

    public readonly transactionInWitness: string[] = [];

    // New properties to hold the decoded public key or hash
    public readonly decodedPubKey: Buffer | null;
    public readonly decodedPubKeyHash: Buffer | null;

    constructor(data: VIn) {
        this.originalTransactionId = data.txid;
        this.outputTransactionIndex = data.vout;

        this.scriptSignature = data.scriptSig;
        this.sequenceId = data.sequence;
        this.transactionInWitness = data.txinwitness || [];

        // for P2PK, P2WPKH, and P2PKH
        this.decodedPubKey = this.decodePubKey();
        this.decodedPubKeyHash = this.decodePubKeyHash();
    }

    public toDocument(): ITransactionInput {
        const returnType: ITransactionInput = {
            originalTransactionId: this.originalTransactionId,
            outputTransactionIndex: this.outputTransactionIndex,

            scriptSignature: this.scriptSignature,
            sequenceId: this.sequenceId,

            transactionInWitness: this.transactionInWitness,
        };

        if (this.decodedPubKey) {
            returnType.pubKey = new Binary(this.decodedPubKey);
        }

        if (this.decodedPubKeyHash) {
            returnType.pubKeyHash = new Binary(this.decodedPubKeyHash);
        }

        return returnType;
    }

    // decode public key for P2PK and SegWit (P2WPKH)
    private decodePubKey(): Buffer | null {
        // Decode from SegWit witness (P2WPKH)
        if (this.transactionInWitness.length === 2) {
            return Buffer.from(this.transactionInWitness[1], 'hex'); // Return the public key in hex format
        }

        // Decode from scriptSig (P2PK)
        if (this.scriptSignature && this.scriptSignature.asm) {
            const parts = this.scriptSignature.asm.split(' ');
            if (parts.length === 2 && parts[1].length === 66) {
                return Buffer.from(parts[1], 'hex'); // Return the public key in hex format
            }
        }

        return null; // No public key found
    }

    // for P2PKH
    private decodePubKeyHash(): Buffer | null {
        if (this.scriptSignature && this.scriptSignature.asm) {
            const parts = this.scriptSignature.asm.split(' ');
            if (parts.length === 2 && parts[1].length === 40) {
                return Buffer.from(parts[1], 'hex'); // Return the public key hash in hex format
            }
        }

        return null; // No public key hash found
    }
}
