import { Transaction } from '../Transaction.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import {
    AccessListFeature,
    EpochSubmissionFeature,
    Feature,
    Features,
} from '../features/Features.js';
import { OPNetHeader } from '../interfaces/OPNetHeader.js';
import { opcodes, payments } from '@btc-vision/bitcoin';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';
import { Address, AddressMap, BinaryReader } from '@btc-vision/transaction';
import { SpecialContract } from '../../../../poa/configurations/types/SpecialContracts.js';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import { Submission } from '../features/Submission.js';

export abstract class SharedInteractionParameters<
    T extends OPNetTransactionTypes,
> extends Transaction<T> {
    public specialSettings: SpecialContract | undefined;

    protected features: Feature<Features>[] = [];

    protected _accessList: AddressMap<Uint8Array[]> | undefined;
    protected _submission: Submission | undefined;

    public get submission(): Submission | undefined {
        return this._submission;
    }

    protected _calldata: Buffer | undefined;

    public get calldata(): Buffer {
        const calldata = Buffer.alloc(this._calldata?.length || 0);

        if (this._calldata) {
            this._calldata.copy(calldata);
        }

        return calldata;
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

        const miner = scriptData.shift();
        if (!Buffer.isBuffer(miner) || miner.length !== 33) {
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

        return new OPNetHeader(header, miner, preimage);
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

    public getAddress(str: string): Address {
        if (this.addressCache) {
            const addr: string | undefined = this.addressCache.get(str);

            if (!addr) {
                const newAddr = Address.fromString(str);
                this.addressCache.set(str, newAddr.toHex());

                return newAddr;
            } else {
                return Address.fromString(str);
            }
        } else {
            return Address.fromString(str);
        }
    }

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

            default: {
                throw new Error(`Feature ${feature.opcode} not implemented`);
            }
        }
    }

    private decodeEpochSubmission(feature: EpochSubmissionFeature): Submission {
        const data: Buffer = feature.data;

        if (data.length > 32 + 33 + OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH) {
            throw new Error(`OP_NET: Invalid epoch submission feature data length.`);
        }

        const binaryReader = new BinaryReader(data);
        const publicKey = binaryReader.readBytes(33);
        const solution = binaryReader.readBytes(32);
        const bytesLeft = data.length - 65;

        let graffiti: Uint8Array | undefined;
        if (bytesLeft > 0 && bytesLeft <= OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH) {
            graffiti = binaryReader.readBytes(bytesLeft);
        }

        return {
            publicKey: publicKey,
            salt: solution,
            graffiti: graffiti,
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
