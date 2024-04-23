import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { EcKeyPair } from '@btc-vision/bsi-transaction';
import bitcoin, { opcodes } from 'bitcoinjs-lib';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInput } from '../inputs/TransactionInput.js';
import { TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

interface DeploymentWitnessData {
    deployerPubKey: Buffer;
    deployerPubKeyHash: Buffer;

    contractSaltPubKey: Buffer;
    contractSaltHash: EcKeyPair;

    bytecode: Buffer;
}

export class DeploymentTransaction extends Transaction<OPNetTransactionTypes.Deployment> {
    public static LEGACY_DEPLOYMENT_SCRIPT: Buffer = Buffer.from([
        opcodes.OP_CHECKSIGVERIFY,

        opcodes.OP_CHECKSIGVERIFY,

        opcodes.OP_HASH160,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_HASH256,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_DEPTH,
        opcodes.OP_1,
        opcodes.OP_NUMEQUAL,
        opcodes.OP_IF,

        opcodes.OP_1NEGATE,

        opcodes.OP_ELSE,
        opcodes.OP_1,
        opcodes.OP_ENDIF,
    ]);

    public readonly transactionType: OPNetTransactionTypes.Deployment =
        DeploymentTransaction.getType();

    protected contractBytecode: Buffer | undefined;
    protected contractSalt: EcKeyPair | undefined;
    protected ownerPubKey: Buffer | undefined;
    protected contractSaltPubKey: Buffer | undefined;
    protected contractSeed: Buffer | undefined;

    constructor(rawTransactionData: TransactionData, vInputIndex: number, blockHash: string) {
        super(rawTransactionData, vInputIndex, blockHash);
    }

    public static is(data: TransactionData): TransactionInformation | undefined {
        const vIndex = this._is(data, this.LEGACY_DEPLOYMENT_SCRIPT);
        if (vIndex === -1) {
            return;
        }

        return {
            type: this.getType(),
            vInIndex: vIndex,
        };
    }

    public static getContractAddress(
        deployerPubKey: Buffer,
        bytecode: Buffer,
        saltHash: Buffer,
    ): Buffer {
        const sha256OfBytecode: Buffer = bitcoin.crypto.sha256(bytecode);
        const buf: Buffer = Buffer.concat([deployerPubKey, saltHash, sha256OfBytecode]);

        return bitcoin.crypto.sha256(buf);
    }

    private static getType(): OPNetTransactionTypes.Deployment {
        return OPNetTransactionTypes.Deployment;
    }

    protected parseTransaction(vIn: VIn[], vOuts: VOut[]) {
        super.parseTransaction(vIn, vOuts);

        console.log(`Parsing deployment transaction ${this.txid}`);

        const inputOPNetWitnessTransactions = this.getInputWitnessTransactions();
        if (inputOPNetWitnessTransactions.length === 0) {
            throw new Error(
                `No input witness transactions found for deployment transaction ${this.txid}`,
            );
        }

        if (inputOPNetWitnessTransactions.length > 1) {
            throw new Error(
                `Can not deploy multiple contracts at the same time. Transaction ${this.txid} has ${inputOPNetWitnessTransactions.length} input witness transactions.`,
            );
        }

        const inputOPNetWitnessTransaction: TransactionInput = inputOPNetWitnessTransactions[0];
        const scriptData = this.getWitnessWithMagic();

        if (!scriptData) {
            throw new Error(`No script data found for deployment transaction ${this.txid}`);
        }

        const deploymentWitnessData = this.getDeploymentWitnessData(scriptData);
        if (!deploymentWitnessData) {
            throw new Error(
                `No deployment witness data found for deployment transaction ${this.txid}`,
            );
        }

        console.log(`Deployment witness data:`, deploymentWitnessData);

        const witnesses: string[] = inputOPNetWitnessTransaction.transactionInWitness;

        const deployerPubKeyXOnly = witnesses[0];
        const originalSalt = witnesses[1];
        
        const contractSaltSignature = witnesses[2];
        const deployerSignature = witnesses[3];

        console.log(deploymentWitnessData, {
            originalSalt,
            deployerPubKeyXOnly,
            contractSaltSignature,
            deployerSignature,
        });
    }

    private getDeploymentWitnessData(
        scriptData: Array<number | Buffer>,
    ): DeploymentWitnessData | undefined {
        const deployerPubKey = scriptData.shift();
        if (!Buffer.isBuffer(deployerPubKey)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        const contractSaltPubKey = scriptData.shift();
        if (!Buffer.isBuffer(contractSaltPubKey)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH160) {
            return;
        }

        const deployerPubKeyHash = scriptData.shift();
        if (!Buffer.isBuffer(deployerPubKeyHash)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH256) {
            return;
        }

        const contractSaltHash = scriptData.shift();
        if (!Buffer.isBuffer(contractSaltHash)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_DEPTH) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_1) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_NUMEQUAL) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_IF) {
            return;
        }

        const magic = scriptData.shift();
        if (!Buffer.isBuffer(magic)) {
            return;
        }

        // ... Future implementation before this opcode
        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        let contractBytecode: Buffer | undefined = undefined;
        for (let i = 0; i < scriptData.length; i++) {
            if (scriptData[i] === opcodes.OP_ELSE) {
                break;
            }

            if (Buffer.isBuffer(scriptData[i])) {
                if (!contractBytecode) {
                    contractBytecode = scriptData[i] as Buffer;
                } else {
                    contractBytecode = Buffer.concat([contractBytecode, scriptData[i] as Buffer]);
                }
            } else {
                throw new Error(`Invalid contract bytecode found in deployment transaction.`);
            }
        }

        if (!contractBytecode) {
            throw new Error(`No contract bytecode found in deployment transaction.`);
        }

        return {
            deployerPubKey,
            contractSaltPubKey,
            deployerPubKeyHash,
            contractSaltHash,
            bytecode: contractBytecode,
        };
    }

    /* For future implementation we return an array here. */
    private getInputWitnessTransactions(): TransactionInput[] {
        return [this.inputs[this.vInputIndex]];
    }

    //private getDeploymentTransactionInput(): TransactionInput {}
}
