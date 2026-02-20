import { TransactionData, VIn, VOut } from '@btc-vision/bitcoin-rpc';
import bitcoin, {
    alloc,
    concat,
    equals as bytesEquals,
    networks,
    opcodes,
    toXOnly,
} from '@btc-vision/bitcoin';
import { createPublicKey, UniversalSigner } from '@btc-vision/ecpair';
import { DeploymentTransactionDocument } from '../../../../db/interfaces/ITransactionDocument.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInput } from '../inputs/TransactionInput.js';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import { TransactionInformation } from '../PossibleOPNetTransactions.js';
import { OPNet_MAGIC } from '../Transaction.js';

import {
    Address,
    ChallengeSolution,
    ContractAddressVerificationParams,
    EcKeyPair,
    EpochSubmissionFeature,
    Feature,
    FeaturePriority,
    Features,
    MLDSALinkRequest,
    TapscriptVerificator,
} from '@btc-vision/transaction';
import { Binary } from 'mongodb';
import { EvaluatedEvents, EvaluatedResult } from '../../../../vm/evaluated/EvaluatedResult.js';
import { OPNetConsensus } from '../../../../poc/configurations/OPNetConsensus.js';
import { OPNetHeader } from '../interfaces/OPNetHeader.js';
import { SharedInteractionParameters } from './SharedInteractionParameters.js';
import { AddressCache } from '../../AddressCache.js';

interface DeploymentWitnessData {
    readonly header: OPNetHeader;

    readonly senderPubKey: Uint8Array;
    hashedSenderPubKey: Uint8Array;

    contractSaltPubKey: Uint8Array;
    contractSaltHash: Uint8Array;

    readonly bytecode: Uint8Array;
    readonly calldata?: Uint8Array;
    readonly features: Feature<Features>[];
}

export class DeploymentTransaction extends SharedInteractionParameters<OPNetTransactionTypes.Deployment> {
    public static LEGACY_DEPLOYMENT_SCRIPT: Uint8Array = new Uint8Array([
        opcodes.OP_TOALTSTACK, // HEADER
        opcodes.OP_TOALTSTACK, // MINER
        opcodes.OP_TOALTSTACK, // PREIMAGE

        opcodes.OP_DUP,
        opcodes.OP_HASH256,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_CHECKSIGVERIFY,
        opcodes.OP_CHECKSIGVERIFY,

        opcodes.OP_HASH256, // diff between deploys and interactions
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_DEPTH,
        opcodes.OP_1,
        opcodes.OP_NUMEQUAL,
        opcodes.OP_IF,

        opcodes.OP_0, // calldata flag
        opcodes.OP_1NEGATE,

        opcodes.OP_ELSE,
        opcodes.OP_1,
        opcodes.OP_ENDIF,
    ]);

    public readonly transactionType: OPNetTransactionTypes.Deployment =
        DeploymentTransaction.getType();

    public bytecode: Uint8Array | undefined;

    public contractSaltHash: Uint8Array | undefined;
    public contractSeed: Uint8Array | undefined;

    public deployerPubKey: Uint8Array | undefined;
    public deployerPubKeyHash: Uint8Array | undefined;

    public contractSigner: UniversalSigner | undefined;

    public constructor(
        rawTransactionData: TransactionData,
        vInputIndex: number,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
        addressCache: AddressCache | undefined,
    ) {
        super(rawTransactionData, vInputIndex, blockHash, blockHeight, network, addressCache);
    }

    protected _contractPublicKey: Uint8Array | undefined;

    public get contractPublicKey(): Uint8Array {
        if (!this._contractPublicKey) {
            throw new Error(`OP_NET: Contract tweaked public key not found.`);
        }

        return this._contractPublicKey;
    }

    protected _contractAddress: Address | undefined;

    public get contractAddress(): string {
        if (!this._contractAddress) throw new Error('OP_NET: Contract address not found');
        return this._contractAddress.p2op(this.network);
    }

    public get address(): Address {
        if (!this._contractAddress) throw new Error('OP_NET: Contract address not found');
        return this._contractAddress;
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

    private static getType(): OPNetTransactionTypes.Deployment {
        return OPNetTransactionTypes.Deployment;
    }

    public toDocument(): DeploymentTransactionDocument {
        const receiptData: EvaluatedResult | undefined = this.receipt;
        const events: EvaluatedEvents | undefined = receiptData?.events;
        const receipt: Uint8Array | undefined = receiptData?.result;
        const receiptProofs: string[] = this.receiptProofs || [];

        if (receipt && receiptProofs.length === 0) {
            throw new Error(`OP_NET: No receipt proofs.`);
        }

        if (!this._contractAddress) {
            throw new Error(`OP_NET: No contract address found.`);
        }

        return {
            ...super.toDocument(),
            from: new Binary(this.from),
            fromLegacy: new Binary(this.from.tweakedPublicKeyToBuffer()),
            contractAddress: this.contractAddress,
            contractPublicKey: new Binary(this.address),

            calldata: new Binary(this.calldata),
            preimage: new Binary(this.preimage),

            receiptProofs: receiptProofs,

            receipt: receipt ? new Binary(receipt) : undefined,
            events: this.convertEvents(events),
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        super.parseTransaction(vIn, vOuts);

        const inputOPNetWitnessTransactions = this.getInputWitnessTransactions();
        if (inputOPNetWitnessTransactions.length === 0) {
            throw new Error(`OP_NET: No input witness transactions.`);
        }

        if (inputOPNetWitnessTransactions.length > 1) {
            throw new Error(`OP_NET: Cannot deploy multiple contracts at the same time.`);
        }

        /** Contract should ALWAYS have ONLY ONE input witness transaction */
        const scriptData = this.getParsedScript(3);
        if (!scriptData) {
            throw new Error(`OP_NET: No script data.`);
        }

        const deploymentWitnessData = this.getDeploymentWitnessData(scriptData);
        if (!deploymentWitnessData) {
            throw new Error(`OP_NET: No deployment witness data.`);
        }

        this.parseFeatures(deploymentWitnessData.features);

        /** We must verify the contract address */
        const inputTxId = this.inputs[this.vInputIndex].originalTransactionId;
        if (!inputTxId || inputTxId.length === 0) {
            throw new Error(`OP_NET: No input transaction id.`);
        }

        const inputOPNetWitnessTransaction: TransactionInput = inputOPNetWitnessTransactions[0];
        const witnesses = inputOPNetWitnessTransaction.transactionInWitness;
        const originalSalt = witnesses[0];

        // Regenerate raw public key
        const deployerPubKey = concat([
            new Uint8Array([deploymentWitnessData.header.publicKeyPrefix]),
            deploymentWitnessData.senderPubKey,
        ]);

        this.deployerPubKey = deployerPubKey;

        // Verify sender pubkey
        const hashSenderPubKey = bitcoin.crypto.hash256(deploymentWitnessData.senderPubKey);
        if (!this.safeEq(hashSenderPubKey, deploymentWitnessData.hashedSenderPubKey)) {
            throw new Error(`OP_NET: Sender public key hash mismatch.`);
        }
        this.deployerPubKeyHash = hashSenderPubKey;

        // end of verify sender pubkey

        // regenerate address
        this._from = new Address(alloc(32), this.deployerPubKey);
        if (!this._from.isValidLegacyPublicKey(this.network)) {
            throw new Error(`OP_NET: Invalid sender address.`);
        }

        // Verify salt validity.
        if (originalSalt.byteLength < 32 || originalSalt.byteLength > 128) {
            throw new Error(`OP_NET: Salt should be between 32 and 128 bytes.`);
        }

        this.contractSeed = originalSalt;

        /** Verify contract salt */
        const hashOriginalSalt = bitcoin.crypto.hash256(originalSalt);
        if (!this.safeEq(hashOriginalSalt, deploymentWitnessData.contractSaltHash)) {
            throw new Error(`OP_NET: Invalid contract salt hash found in deployment transaction.`);
        }

        this.contractSaltHash = hashOriginalSalt;

        // Set bytecode and calldata
        this.bytecode = deploymentWitnessData.bytecode;
        this._calldata = deploymentWitnessData.calldata;

        /** Restore contract seed/address */
        this._contractPublicKey = TapscriptVerificator.getContractSeed(
            toXOnly(createPublicKey(deployerPubKey)),
            this.bytecode,
            hashOriginalSalt,
        );

        /** Generate contract segwit address */
        this._contractAddress = new Address(this._contractPublicKey);

        this.contractSigner = EcKeyPair.fromSeedKeyPair(this._contractPublicKey, this.network);

        if (
            !this.contractSigner.publicKey ||
            !bytesEquals(
                deploymentWitnessData.contractSaltPubKey,
                toXOnly(this.contractSigner.publicKey),
            )
        ) {
            throw new Error(`OP_NET: Invalid contract signer.`);
        }

        this.setMiner(
            deploymentWitnessData.header.minerMLDSAPublicKey,
            deploymentWitnessData.header.solution,
        );

        /** We regenerate the contract address and verify it */
        const input0: TransactionInput = this.inputs[0];
        const controlBlock = input0.transactionInWitness[input0.transactionInWitness.length - 1];
        this.getOriginalContractAddress(controlBlock, deploymentWitnessData.header.priorityFeeSat);

        const outputWitness: TransactionOutput = this.outputs[0]; // SHOULD ALWAYS BE 0.
        const decodedAddress = this.decodeAddress(outputWitness);
        if (decodedAddress !== this.contractAddress) {
            throw new Error(
                `OP_NET: Invalid contract address. ${outputWitness?.scriptPubKey?.address} != ${this.contractAddress}`,
            );
        }

        /** We set the fee burned to the output witness */
        this.setBurnedFee(outputWitness);

        this.verifyRewardUTXO(1);
        this.setGasFromHeader(deploymentWitnessData.header);

        /** Decompress contract bytecode if needed */
        this.decompress();
    }

    private getFeatures(): Feature<Features>[] {
        const features: Feature<Features>[] = [];
        if (this._submission) {
            const epochSubmission: EpochSubmissionFeature = {
                priority: FeaturePriority.EPOCH_SUBMISSION,
                opcode: Features.EPOCH_SUBMISSION,
                data: {
                    publicKey: new Address(this._submission.mldsaPublicKey),
                    solution: this._submission.salt,
                    graffiti: this._submission.graffiti,
                    epochNumber: 0n,
                    signature: new Uint8Array(0),
                    verifySignature: function (): boolean {
                        return true;
                    },
                },
            };

            features.push(epochSubmission);
        }

        if (this._mldsaLinkRequest) {
            const feature: MLDSALinkRequest = {
                priority: FeaturePriority.MLDSA_LINK_PUBKEY,
                opcode: Features.MLDSA_LINK_PUBKEY,
                data: {
                    verifyRequest: this._mldsaLinkRequest.mldsaSignature !== null,
                    hashedPublicKey: this._mldsaLinkRequest.hashedPublicKey,
                    publicKey: this._mldsaLinkRequest.publicKey,
                    level: this._mldsaLinkRequest.level,
                    mldsaSignature: this._mldsaLinkRequest.mldsaSignature,
                    legacySignature: this._mldsaLinkRequest.legacySignature,
                },
            };

            features.push(feature);
        }

        /*if (this._accessList) {
            features.push({
                opcode: Features.ACCESS_LIST,
                data: this._accessList.raw,
            });
        }*/

        return features;
    }

    private getOriginalContractAddress(controlBlock: Uint8Array, priorityFee: bigint): void {
        if (!this.deployerPubKey) throw new Error('Deployer public key not found');
        if (!this.contractSigner) throw new Error('Contract signer not found');
        if (!this.contractSeed) throw new Error('Contract seed not found');
        if (!this.bytecode) throw new Error('Compressed bytecode not found');

        const unsafePreimage: ChallengeSolution = {
            solution: this.preimage,
            publicKey: new Address(this.miner, this.minerLegacyPublicKey),
        } as unknown as ChallengeSolution;

        const features: Feature<Features>[] = this.getFeatures();

        const params: ContractAddressVerificationParams = {
            deployerPubKey: createPublicKey(this.deployerPubKey),
            contractSaltPubKey: this.contractSigner.publicKey,
            originalSalt: this.contractSeed,
            bytecode: this.bytecode,
            calldata: this._calldata && this._calldata.length > 0 ? this._calldata : undefined,
            challenge: unsafePreimage,
            network: this.network,
            priorityFee: priorityFee,
            features: features,
        };

        let tapContractAddress: boolean;
        try {
            tapContractAddress = TapscriptVerificator.verifyControlBlock(params, controlBlock);
        } catch (e) {
            throw new Error(
                `OP_NET: Invalid contract address from control block. ${(e as Error).stack}`,
                { cause: e },
            );
        }

        if (!tapContractAddress) {
            throw new Error(`OP_NET: Invalid contract address from control block.`);
        }
    }

    /** We must check if the bytecode was compressed using GZIP. If so, we must decompress it. */
    private decompress(): void {
        if (!this.bytecode) throw new Error('Bytecode not found');
        this.bytecode = this.decompressData(this.bytecode);

        const deploymentVersion = this.bytecode[0];
        if (OPNetConsensus.consensus.VM.CURRENT_DEPLOYMENT_VERSION < deploymentVersion) {
            throw new Error(`Version not supported.`);
        }

        if (this._calldata) this._calldata = this.decompressData(this._calldata);
    }

    private getDeploymentWitnessData(
        scriptData: Array<number | Uint8Array>,
    ): DeploymentWitnessData | undefined {
        const header = DeploymentTransaction.decodeOPNetHeader(scriptData);
        if (!header) {
            return;
        }

        // Enforce 32 bytes pubkey only.
        const senderPubKey = scriptData.shift();
        if (!(senderPubKey instanceof Uint8Array) || senderPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_DUP) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH256) {
            return;
        }

        const hashedSenderPubKey = scriptData.shift();
        if (!(hashedSenderPubKey instanceof Uint8Array) || hashedSenderPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        // end of checks for sender pubkey

        const contractSaltPubKey = scriptData.shift();
        if (!(contractSaltPubKey instanceof Uint8Array) || contractSaltPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH256) {
            return;
        }

        // end of checks for contract salt pubkey

        const contractSaltHash = scriptData.shift();
        if (!(contractSaltHash instanceof Uint8Array) || contractSaltHash.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        // end of checks for contract salt hash

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
        if (
            !(magic instanceof Uint8Array) ||
            magic.length !== 2 ||
            !bytesEquals(magic, OPNet_MAGIC)
        ) {
            return;
        }

        const features = SharedInteractionParameters.decodeFeatures(header, scriptData);

        // Calldata flag
        if (scriptData.shift() !== opcodes.OP_0) {
            return;
        }

        const calldata = DeploymentTransaction.getDataFromScript(
            scriptData,
            opcodes.OP_1NEGATE, // next opcode
        );

        if (
            calldata &&
            OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CALLDATA_SIZE_COMPRESSED <
                calldata.byteLength
        ) {
            throw new Error(`OP_NET: Calldata length exceeds maximum allowed size.`);
        }

        // ... Future implementation before this opcode
        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        const contractBytecode = DeploymentTransaction.getDataFromScript(scriptData);
        if (!contractBytecode) {
            throw new Error(`OP_NET: No contract bytecode.`);
        }

        if (
            OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CONTRACT_SIZE_COMPRESSED <
            contractBytecode.byteLength
        ) {
            throw new Error(`OP_NET: Contract length exceeds maximum allowed size.`);
        }

        return {
            header,
            hashedSenderPubKey,
            senderPubKey,
            contractSaltPubKey,
            contractSaltHash,
            bytecode: contractBytecode,
            calldata: calldata,
            features: features,
        };
    }

    /* For future implementation we return an array here. */
    private getInputWitnessTransactions(): TransactionInput[] {
        return [this.inputs[this.vInputIndex]];
    }
}
