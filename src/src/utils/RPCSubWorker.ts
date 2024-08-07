import { VMStorage } from '../vm/storage/VMStorage.js';
import { VMManager } from '../vm/VMManager.js';
import { Config } from '../config/Config.js';
import { Logger } from '@btc-vision/bsi-common';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import {
    CallRequestData,
    CallRequestResponse,
} from '../threading/interfaces/thread-messages/messages/api/CallRequest.js';
import { DebugLevel } from '@btc-vision/logger';
import { BTC_FAKE_ADDRESS } from '../blockchain-indexer/processor/block/types/ZeroValue.js';
import {
    BlockDataAtHeightData,
    ValidatedBlockHeader,
} from '../threading/interfaces/thread-messages/messages/api/ValidateBlockHeaders.js';
import {
    BlockHeaderBlockDocument,
    BlockHeaderChecksumProof,
} from '../db/interfaces/IBlockHeaderBlockDocument.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { BroadcastResponse } from '../threading/interfaces/thread-messages/messages/api/BroadcastRequest.js';
import { ChecksumProof } from '../poa/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { BlockchainStorageMap } from '../vm/evaluated/EvaluatedResult.js';

class RPCManager extends Logger {
    public readonly logColor: string = '#00ff66';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly vmManagers: VMManager[] = [];
    private currentVMManagerIndex: number = 0;

    private readonly CONCURRENT_VMS: number = 1;

    private currentBlockHeight: bigint = 0n;

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(message: string): Promise<void> {
        try {
            const data = JSON.parse(message) as { taskId: string; data: object; type: string };

            if (data.type === 'call') {
                let result = await this.onCallRequest(data.data as CallRequestData);
                if (result && !('error' in result)) {
                    result = {
                        ...result,
                        // @ts-ignore
                        result: result.result ? Buffer.from(result.result).toString('hex') : '',
                        // @ts-ignore
                        changedStorage: this.convertMapToArray(result.changedStorage),
                    };
                }

                this.send({
                    taskId: data.taskId,
                    data: result,
                });
            }
        } catch (e) {
            this.error(`Failed to process message. ${e}`);
        }
    }

    protected listenToEvents(): void {
        process.on('message', this.onMessage.bind(this));
    }

    protected async init(): Promise<void> {
        this.listenToEvents();

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
        await this.setBlockHeight();
        await this.createVMManagers();
    }

    protected async getNextVMManager(tries: number = 0): Promise<VMManager> {
        if (tries > 10) {
            throw new Error('Failed to get a VMManager');
        }

        return new Promise<VMManager>((resolve) => {
            let startNumber = this.currentVMManagerIndex;
            let vmManager: VMManager | undefined;

            do {
                vmManager = this.vmManagers[this.currentVMManagerIndex];
                this.currentVMManagerIndex = (this.currentVMManagerIndex + 1) % this.CONCURRENT_VMS;

                if (!vmManager.busy() && vmManager.initiated) {
                    break;
                }
            } while (this.currentVMManagerIndex !== startNumber);

            if (!vmManager) {
                setTimeout(async () => {
                    this.warn(
                        `High load detected. Try to increase your RPC thread limit or do fewer requests.`,
                    );

                    const vmManager = await this.getNextVMManager(tries + 1);
                    resolve(vmManager);
                }, 100);
            }

            resolve(vmManager);
        });
    }

    private convertMapToArray(map: BlockchainStorageMap): [string, [string, string][]][] {
        const array: [string, [string, string][]][] = [];

        for (const [key, value] of map) {
            const innerArray: [string, string][] = [];
            for (const [innerKey, innerValue] of value) {
                innerArray.push([innerKey.toString(), innerValue.toString()]);
            }

            array.push([key, innerArray]);
        }

        return array;
    }

    private send(data: object): void {
        if (!process.send) throw new Error('process.send is not a function');

        process.send(data);
    }

    private async setBlockHeight(): Promise<void> {
        try {
            const blockHeight = await this.bitcoinRPC.getBlockHeight();
            if (!blockHeight) {
                throw new Error('Failed to get block height');
            }

            this.currentBlockHeight = BigInt(blockHeight.blockHeight + 1);
            OPNetConsensus.setBlockHeight(this.currentBlockHeight);
        } catch (e) {
            this.error(`Failed to get block height. ${e}`);
        }

        setTimeout(() => {
            void this.setBlockHeight();
        }, 5000);
    }

    private async createVMManagers(): Promise<void> {
        let vmStorage: VMStorage | undefined = undefined;
        for (let i = 0; i < this.CONCURRENT_VMS; i++) {
            const vmManager: VMManager = new VMManager(Config, true, vmStorage);
            await vmManager.init();

            if (!vmStorage) {
                vmStorage = vmManager.getVMStorage();
            }

            this.vmManagers.push(vmManager);
        }

        setInterval(() => {
            for (let i = 0; i < this.vmManagers.length; i++) {
                const vmManager = this.vmManagers[i];
                vmManager.clear();
            }
        }, 30000);
    }

    private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.info(
                `Call request received. {To: ${data.to.toString()}, Calldata: ${data.calldata}}`,
            );
        }

        const vmManager = await this.getNextVMManager();

        let result: CallRequestResponse | void;
        try {
            result = await vmManager.execute(
                data.to,
                data.from || BTC_FAKE_ADDRESS,
                data.calldata,
                data.blockNumber,
            );
        } catch (e) {
            const error = e as Error;

            result = {
                error: error.message || 'Unknown error',
            };
        }

        return result;
    }

    private async validateBlockHeaders(data: BlockDataAtHeightData): Promise<ValidatedBlockHeader> {
        const blockNumber = BigInt(data.blockNumber);
        const blockHeader = data.blockHeader;

        const vmBlockHeader: Partial<BlockHeaderBlockDocument> = {
            previousBlockHash: blockHeader.previousBlockHash,
            height: DataConverter.toDecimal128(blockNumber),
            receiptRoot: blockHeader.receiptRoot,
            storageRoot: blockHeader.storageRoot,
            hash: blockHeader.blockHash,
            merkleRoot: blockHeader.merkleRoot,
            checksumRoot: blockHeader.checksumHash,
            previousBlockChecksum: blockHeader.previousBlockChecksum,
            checksumProofs: this.getChecksumProofs(blockHeader.checksumProofs),
        };

        const vmManager = await this.getNextVMManager();

        try {
            const requests: [
                Promise<boolean | null>,
                Promise<BlockHeaderBlockDocument | undefined>,
            ] = [
                vmManager.validateBlockChecksum(vmBlockHeader),
                vmManager.getBlockHeader(blockNumber),
            ];

            const [hasValidProofs, fetchedBlockHeader] = await Promise.all(requests);
            return {
                hasValidProofs: hasValidProofs,
                storedBlockHeader: fetchedBlockHeader ?? null,
            };
        } catch (e) {}

        return {
            hasValidProofs: false,
            storedBlockHeader: null,
        };
    }

    private async broadcastTransaction(transaction: string): Promise<BroadcastResponse> {
        const response: BroadcastResponse = {
            success: false,
            identifier: 0n,
        };

        const result: string | null = await this.bitcoinRPC
            .sendRawTransaction({ hexstring: transaction })
            .catch((e) => {
                const error = e as Error;
                response.error = error.message || 'Unknown error';

                return null;
            });

        response.success = result !== null;
        if (result) response.result = result;

        return response;
    }

    private getChecksumProofs(rawProofs: ChecksumProof[]): BlockHeaderChecksumProof {
        const proofs: BlockHeaderChecksumProof = [];

        for (let i = 0; i < rawProofs.length; i++) {
            const proof = rawProofs[i];
            const data: [number, string[]] = [i, proof.proof];

            proofs.push(data);
        }

        return proofs;
    }
}

new RPCManager();
