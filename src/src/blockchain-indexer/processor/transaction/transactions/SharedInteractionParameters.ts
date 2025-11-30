import { Transaction } from '../Transaction.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import {
    AccessListFeature,
    EpochSubmissionFeature,
    Feature,
    MLDSALinkRequest,
} from '../features/Features.js';
import { OPNetHeader } from '../interfaces/OPNetHeader.js';
import { opcodes, payments } from '@btc-vision/bitcoin';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';
import {
    Address,
    AddressMap,
    BinaryReader,
    BinaryWriter,
    Features,
    MessageSigner,
    MLDSASecurityLevel,
    QuantumBIP32Factory,
} from '@btc-vision/transaction';
import { SpecialContract } from '../../../../poa/configurations/types/SpecialContracts.js';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import { Submission } from '../features/Submission.js';
import { timingSafeEqual } from 'node:crypto';
import { MLDSARequestData } from '../features/MLDSARequestData.js';
import { MLDSAMetadata } from '../../../../vm/mldsa/MLDSAMetadata.js';
import { VMManager } from '../../../../vm/VMManager.js';
import { getChainId } from '../../../../vm/rust/ChainIdHex.js';
import { NetworkConverter } from '../../../../config/network/NetworkConverter.js';

export abstract class SharedInteractionParameters<
    T extends OPNetTransactionTypes,
> extends Transaction<T> {
    public specialSettings: SpecialContract | undefined;

    protected features: Feature<Features>[] = [];

    protected _accessList: AddressMap<Uint8Array[]> | undefined;

    protected _calldata: Buffer | undefined;

    public get calldata(): Buffer {
        const calldata = Buffer.alloc(this._calldata?.length || 0);

        if (this._calldata) {
            this._calldata.copy(calldata);
        }

        return calldata;
    }

    protected _mldsaLinkRequest: MLDSARequestData | undefined;

    public get mldsaLinkRequest(): MLDSARequestData | undefined {
        return this._mldsaLinkRequest;
    }

    public get preloadStorageList(): AddressMap<Uint8Array[]> {
        return this._accessList || new AddressMap();
    }

    public static getDataFromScript(
        scriptData: Array<number | Buffer>,
        breakWhenReachOpcode: number = opcodes.OP_ELSE,
    ): Buffer | undefined {
        let data: Buffer | undefined;

        // Keep reading until we see the break opcode or run out of script data.
        while (scriptData.length > 0) {
            const currentItem = scriptData[0];

            // If this matches our break opcode, stop but do NOT consume it:
            // The caller may wish to explicitly check/shift that next.
            if (currentItem === breakWhenReachOpcode) {
                break;
            }

            // Remove the item from the front:
            scriptData.shift();

            // Validate it should be a Buffer; if not, it's invalid bytecode.
            if (!Buffer.isBuffer(currentItem)) {
                throw new Error(`Invalid contract bytecode found in transaction script.`);
            }

            // Accumulate the data
            data = data ? Buffer.concat([data, currentItem]) : currentItem;
        }

        return data;
    }

    public static getDataUntilBufferEnd(scriptData: Array<number | Buffer>): Buffer | undefined {
        let data: Buffer | undefined;

        // Keep reading until we see the break opcode or run out of script data.
        while (scriptData.length > 0) {
            const currentItem = scriptData[0];

            // Validate it should be a Buffer; if not, it's invalid bytecode.
            if (!Buffer.isBuffer(currentItem)) {
                break;
            }

            // Remove the item from the front:
            scriptData.shift();

            // Accumulate the data
            data = data ? Buffer.concat([data, currentItem]) : currentItem;
        }

        return data;
    }

    protected static decodeOPNetHeader(
        scriptData: Array<number | Buffer>,
    ): OPNetHeader | undefined {
        const header = scriptData.shift();
        if (!Buffer.isBuffer(header) || header.length !== OPNetHeader.EXPECTED_HEADER_LENGTH) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_TOALTSTACK) {
            return;
        }

        const minerMLDSAPublicKey = scriptData.shift();
        if (!Buffer.isBuffer(minerMLDSAPublicKey) || minerMLDSAPublicKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_TOALTSTACK) {
            return;
        }

        const preimage = scriptData.shift();
        if (
            !Buffer.isBuffer(preimage) ||
            preimage.length !== OPNetConsensus.consensus.POW.PREIMAGE_LENGTH
        ) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_TOALTSTACK) {
            return;
        }

        return new OPNetHeader(header, minerMLDSAPublicKey, preimage);
    }

    protected static decodeFeatures(
        header: OPNetHeader,
        scriptData: Array<number | Buffer>,
    ): Feature<Features>[] {
        const features = header.decodeFlags();

        const decodedData: Feature<Features>[] = [];
        for (let i = 0; i < features.length; i++) {
            const feature: Feature<Features> = {
                opcode: features[i],
                data: this.getDataUntilBufferEnd(scriptData),
            };

            decodedData.push(feature);
        }

        return decodedData;
    }

    public async assignMLDSAToLegacy(vmManager: VMManager): Promise<void> {
        if (!this.mldsaLinkRequest) {
            await this.regenerateProvenance(vmManager);
            return;
        }

        const tweakedKey = this.from.tweakedPublicKeyToBuffer();
        const chainId = getChainId(NetworkConverter.networkToBitcoinNetwork(this.network));

        const writer = new BinaryWriter();
        writer.writeU8(this.mldsaLinkRequest.level);
        writer.writeBytes(this.mldsaLinkRequest.hashedPublicKey);
        writer.writeBytes(tweakedKey);
        writer.writeBytes(OPNetConsensus.consensus.PROTOCOL_ID);
        writer.writeBytes(chainId);

        const message = writer.getBuffer();

        // First we check the schnorr signature
        const isValidSchnorr = MessageSigner.verifySignature(
            tweakedKey,
            message,
            this.mldsaLinkRequest.legacySignature,
        );

        if (!isValidSchnorr) {
            throw new Error(`OP_NET: Invalid ML-DSA legacy signature for public key link request.`);
        }

        if (this.mldsaLinkRequest.verifyRequest) {
            // Reveal the public key assigned to the hashed version. Once revealed, the user may now use mldsa signatures
            // in contracts and to authorize their opnet transaction.

            await this.verifyMLDSASignature(this.mldsaLinkRequest, tweakedKey, chainId, vmManager);
        } else {
            // Public key is null, this is just a post-quantum safe way to bind the keypair. We do not force users to reveal due to the amount of data
            // required to do this action on-chain.

            await vmManager.addMLDSAInfoToStore({
                hashedPublicKey: this.mldsaLinkRequest.hashedPublicKey,
                legacyPublicKey: tweakedKey,
                publicKey: null,
                level: this.mldsaLinkRequest.level,
                insertedBlockHeight: this.blockHeight,
                exposedBlockHeight: null,
            });
        }

        // From this point, even if the transaction fail, we still record the key link. (as long the provided signatures are valid.)

        // The next action is safe here since if the public key (legacy) is already assigned OR the mldsa hashed value
        // is already assigned, then this will throw.

        // Regenerate the real from.
        this._from = new Address(this.mldsaLinkRequest.hashedPublicKey, tweakedKey);
    }

    public async verifyMLDSASignature(
        mldsaLinkRequest: MLDSARequestData,
        tweakedKey: Buffer,
        chainId: Uint8Array,
        vmManager: VMManager,
    ): Promise<void> {
        if (!mldsaLinkRequest.publicKey) {
            throw new Error(`MLDSA public key not provided.`);
        }

        if (!mldsaLinkRequest.mldsaSignature) {
            throw new Error(`MLDSA signature not provided.`);
        }

        const hashed = MessageSigner.sha256(mldsaLinkRequest.publicKey);
        if (!hashed.equals(mldsaLinkRequest.hashedPublicKey)) {
            throw new Error(`MLDSA public key does not match the hashed public key.`);
        }

        const writer = new BinaryWriter();
        writer.writeU8(mldsaLinkRequest.level);
        writer.writeBytes(mldsaLinkRequest.hashedPublicKey);
        writer.writeBytes(mldsaLinkRequest.publicKey);
        writer.writeBytes(tweakedKey);
        writer.writeBytes(OPNetConsensus.consensus.PROTOCOL_ID);
        writer.writeBytes(chainId);

        const message = writer.getBuffer();

        // Then we check the ML-DSA signature
        const mldsaKeyPair = QuantumBIP32Factory.fromPublicKey(
            mldsaLinkRequest.publicKey,
            Buffer.alloc(32, 0),
            this.network,
            mldsaLinkRequest.level,
        );

        const isValidMLDSA = MessageSigner.verifyMLDSASignature(
            mldsaKeyPair,
            message,
            mldsaLinkRequest.mldsaSignature,
        );

        if (!isValidMLDSA) {
            throw new Error(`OP_NET: Invalid ML-DSA signature for public key link request.`);
        }

        await vmManager.exposeMLDSAPublicKey({
            hashedPublicKey: mldsaLinkRequest.hashedPublicKey,
            legacyPublicKey: tweakedKey,
            publicKey: mldsaLinkRequest.publicKey,
            level: mldsaLinkRequest.level,
            insertedBlockHeight: null,
            exposedBlockHeight: this.blockHeight,
        });
    }

    protected safeEq(a: Buffer, b: Buffer): boolean {
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
    }

    /*public getAddress(str: string): Address {
        if (this.addressCache) {
            const addr: string | undefined = this.addressCache.get(str);

            if (!addr) {
                const newAddr = new Address(, str);
                this.addressCache.set(str, newAddr.toHex());

                return newAddr;
            } else {
                return Address.fromString(str);
            }
        } else {
            return Address.fromString(str);
        }
    }*/

    protected decodeAddress(outputWitness: TransactionOutput): string | undefined {
        if (!outputWitness?.scriptPubKey.hex.startsWith('60')) {
            // OP_16
            throw new Error(`Output does not have a valid p2op address.`);
        }

        const { address } = payments.p2op({
            output: Buffer.from(outputWitness.scriptPubKey.hex, 'hex'),
            network: this.network,
        });

        return address;
    }

    protected decompressData(buffer: Buffer): Buffer {
        const decompressed = Transaction.decompressBuffer(buffer);
        if (decompressed.compressed) {
            this.wasCompressed = true;
        }

        return decompressed.out;
    }

    protected parseFeatures(features: Feature<Features>[]): void {
        for (let i = 0; i < features.length; i++) {
            const feature = features[i];

            this.decodeFeature(feature);
        }
    }

    private async regenerateProvenance(vmManager: VMManager): Promise<void> {
        const originalKey = this.from.tweakedPublicKeyToBuffer();

        // Get the key assigned to the legacy address.
        const keyData = await vmManager.getMLDSAPublicKeyFromLegacyKey(originalKey);
        if (!keyData) {
            throw new Error(`OP_NET: No ML-DSA public key linked to the legacy address.`);
        }

        // Regenerate the real from.
        this._from = new Address(keyData.hashedPublicKey, originalKey);
    }

    private decodeFeature(feature: Feature<Features>): void {
        switch (feature.opcode) {
            case Features.ACCESS_LIST: {
                this._accessList = this.decodeAccessList(feature as AccessListFeature);
                break;
            }

            case Features.EPOCH_SUBMISSION: {
                this._submission = this.decodeEpochSubmission(feature as EpochSubmissionFeature);
                break;
            }

            case Features.MLDSA_LINK_PUBKEY: {
                this._mldsaLinkRequest = this.decodeMLDSALinkRequest(feature as MLDSALinkRequest);
                break;
            }

            default: {
                throw new Error(`Feature ${feature.opcode} not implemented`);
            }
        }
    }

    private decodeMLDSALinkRequest(feature: MLDSALinkRequest): MLDSARequestData {
        const data: Buffer = feature.data;

        const reader = new BinaryReader(data);
        const level: MLDSASecurityLevel = reader.readU8() as MLDSASecurityLevel;

        if (!OPNetConsensus.consensus.MLDSA.ENABLED_LEVELS.includes(level)) {
            throw new Error(`OP_NET: ML-DSA level ${level} is not enabled.`);
        }

        const hashedPublicKey = Buffer.from(reader.readBytes(32));
        const verifyRequest = reader.readBoolean();

        let publicKey: Buffer | null = null;
        let signature: Buffer | null = null;
        if (verifyRequest) {
            const publicKeyLength = MLDSAMetadata.fromLevel(level);
            const signatureLength = MLDSAMetadata.signatureLen(publicKeyLength);

            publicKey = Buffer.from(reader.readBytes(publicKeyLength));
            signature = Buffer.from(reader.readBytes(signatureLength));
        }

        // Load schnorr signature (64 bytes)
        const legacySignature = reader.readBytes(64);

        return {
            verifyRequest,
            hashedPublicKey,
            publicKey: publicKey,
            level: level,
            mldsaSignature: signature,
            legacySignature: Buffer.from(legacySignature),
        };
    }

    private decodeEpochSubmission(feature: EpochSubmissionFeature): Submission {
        const data: Buffer = feature.data;

        if (data.length > 32 + 32 + OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH) {
            throw new Error(`OP_NET: Invalid epoch submission feature data length.`);
        }

        const binaryReader = new BinaryReader(data);
        const mldsaPublicKey = binaryReader.readBytes(32);
        const solution = binaryReader.readBytes(32);
        const bytesLeft = data.length - 65;

        let graffiti: Uint8Array | undefined;
        if (bytesLeft > 0 && bytesLeft <= OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH) {
            graffiti = binaryReader.readBytesWithLength(bytesLeft);
        }

        return {
            mldsaPublicKey: Buffer.from(mldsaPublicKey),
            salt: Buffer.from(solution),
            graffiti: graffiti ? Buffer.from(graffiti) : undefined,
        };
    }

    private decodeAccessList(feature: AccessListFeature): AddressMap<Uint8Array[]> {
        if (!OPNetConsensus.consensus.TRANSACTIONS.ENABLE_ACCESS_LIST) {
            throw new Error(`OP_NET: Access list feature is not enabled.`);
        }

        if (!feature.data.length) {
            return new AddressMap();
        }

        const accessList: AddressMap<Uint8Array[]> = new AddressMap();
        try {
            const decompressedData = this.decompressData(feature.data);
            const binaryReader = new BinaryReader(decompressedData);
            const accessListLength = binaryReader.readU16();

            for (let i = 0; i < accessListLength; i++) {
                const contract = binaryReader.readAddress();
                if (accessList.has(contract)) {
                    throw new Error(`Duplicate contract address in access list`);
                }

                const pointerLength = binaryReader.readU32();
                const storage: Uint8Array[] = [];
                for (let j = 0; j < pointerLength; j++) {
                    storage.push(binaryReader.readBytes(32));
                }

                accessList.set(contract, storage);
            }
        } catch {
            throw new Error(`OP_NET: Unable to decode access list`);
        }

        return accessList;
    }
}
