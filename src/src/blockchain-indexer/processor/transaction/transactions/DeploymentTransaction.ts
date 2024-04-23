import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { EcKeyPair } from '@btc-vision/bsi-transaction';
import bitcoin, { opcodes } from 'bitcoinjs-lib';
import { ECPairInterface } from 'ecpair';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInput } from '../inputs/TransactionInput.js';
import { TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

interface DeploymentWitnessData {
    deployerPubKey: Buffer;
    deployerPubKeyHash: Buffer;

    contractSaltPubKey: Buffer;
    contractSaltHash: Buffer;

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
    protected contractSaltHash: Buffer | undefined;

    protected deployerPubKey: Buffer | undefined;
    protected deployerPubKeyHash: Buffer | undefined;

    protected contractSigner: ECPairInterface | undefined;
    protected contractVirtualAddress: Buffer | undefined;

    constructor(
        rawTransactionData: TransactionData,
        vInputIndex: number,
        blockHash: string,
        network: bitcoin.networks.Network,
    ) {
        super(rawTransactionData, vInputIndex, blockHash, network);
    }

    public get routingAddress(): string {
        if (!this.contractVirtualAddress) {
            throw new Error('Contract virtual address not found');
        }

        return '0x' + this.contractVirtualAddress.toString('hex');
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

    public static getContractSeed(
        deployerPubKey: Buffer,
        bytecode: Buffer,
        saltHash: Buffer,
    ): Buffer {
        const sha256OfBytecode: Buffer = bitcoin.crypto.hash256(bytecode);
        const buf: Buffer = Buffer.concat([deployerPubKey, saltHash, sha256OfBytecode]);

        return bitcoin.crypto.hash256(buf);
    }

    private static getType(): OPNetTransactionTypes.Deployment {
        return OPNetTransactionTypes.Deployment;
    }

    protected parseTransaction(vIn: VIn[], vOuts: VOut[]) {
        super.parseTransaction(vIn, vOuts);

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

        this.contractBytecode = deploymentWitnessData.bytecode;

        const witnesses: string[] = inputOPNetWitnessTransaction.transactionInWitness;
        const originalSalt = Buffer.from(witnesses[0], 'hex');
        const deployerPubKey = Buffer.from(witnesses[1], 'hex');

        /** Verify witness data */
        const hashDeployerPubKey = bitcoin.crypto.hash160(deployerPubKey);
        if (!hashDeployerPubKey.equals(deploymentWitnessData.deployerPubKeyHash)) {
            throw new Error(
                `Invalid deployer public key hash found in deployment transaction. Expected ${deploymentWitnessData.deployerPubKeyHash.toString(
                    'hex',
                )} but got ${hashDeployerPubKey.toString('hex')}`,
            );
        }

        this.deployerPubKeyHash = hashDeployerPubKey;
        this.deployerPubKey = deployerPubKey;

        /** Verify contract salt */
        const hashOriginalSalt: Buffer = bitcoin.crypto.hash256(originalSalt);
        if (!hashOriginalSalt.equals(deploymentWitnessData.contractSaltHash)) {
            throw new Error(
                `Invalid contract salt hash found in deployment transaction. Expected ${deploymentWitnessData.contractSaltHash.toString(
                    'hex',
                )} but got ${hashOriginalSalt.toString('hex')}`,
            );
        }

        this.contractSaltHash = hashOriginalSalt;

        /** Restore contract seed/address */
        this.contractVirtualAddress = DeploymentTransaction.getContractSeed(
            deployerPubKey,
            this.contractBytecode,
            hashOriginalSalt,
        );

        this.contractSigner = EcKeyPair.fromSeedKeyPair(this.contractVirtualAddress, this.network);

        /** TODO: Verify signatures, OPTIONAL */

        /** When deploying a contract, the FIRST output should always be the contract tapscript witness */
        const witnessOutput = this.outputs[0];
        const scriptPubKey = witnessOutput.scriptPubKey;

        if (scriptPubKey.type !== 'witness_v1_taproot') {
            throw new Error('Invalid scriptPubKey type for contract witness output');
        }

        if (!scriptPubKey.address) {
            throw new Error('No address found for contract witness output');
        }

        // We set fees sent to the contract as burned fees
        this._burnedFee = this.decimalOutputToBigInt(witnessOutput.value);
        console.log(
            `Burned ${this._burnedFee} sat to deploy contract at ${scriptPubKey.address}! Contract virtual routing address: ${this.routingAddress}`,
        );

        /** Decompress if needed */
        this.decompressBytecode();

        console.log(this);
    }

    /** We must check if the bytecode was compressed using GZIP. If so, we must decompress it. */
    private decompressBytecode(): void {
        this.contractBytecode = this.decompressData(this.contractBytecode);
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
