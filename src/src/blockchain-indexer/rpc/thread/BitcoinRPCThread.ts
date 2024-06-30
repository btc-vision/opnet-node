import { BitcoinRawTransactionParams, BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { Config } from '../../../config/Config.js';
import {
    BlockHeaderBlockDocument,
    BlockHeaderChecksumProof,
} from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { ChecksumProof } from '../../../poa/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import {
    CallRequestData,
    CallRequestResponse,
} from '../../../threading/interfaces/thread-messages/messages/api/CallRequest.js';
import { RPCMessage } from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import {
    BlockDataAtHeightData,
    ValidatedBlockHeader,
} from '../../../threading/interfaces/thread-messages/messages/api/ValidateBlockHeaders.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../../../threading/thread/Thread.js';
import { VMManager } from '../../../vm/VMManager.js';
import { BitcoinRPCThreadMessageType } from './messages/BitcoinRPCThreadMessage.js';
import { BroadcastResponse } from '../../../threading/interfaces/thread-messages/messages/api/BroadcastRequest.js';
import { BTC_FAKE_ADDRESS } from '../../processor/block/types/ZeroValue.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';

export class BitcoinRPCThread extends Thread<ThreadTypes.BITCOIN_RPC> {
    public readonly threadType: ThreadTypes.BITCOIN_RPC = ThreadTypes.BITCOIN_RPC;

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly vmManagers: VMManager[] = [];
    private currentVMManagerIndex: number = 0;

    private readonly CONCURRENT_VMS: number = 10;

    private currentBlockHeight: bigint = 0n;

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
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
            let nextCurrent: number = this.currentVMManagerIndex;
            let vmManager: VMManager | undefined;

            do {
                vmManager = this.vmManagers[this.currentVMManagerIndex];
                nextCurrent = (nextCurrent + 1) % this.CONCURRENT_VMS;

                if (!vmManager.busy() && vmManager.initiated) {
                    break;
                }
            } while (nextCurrent !== startNumber);

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

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | void> {
        if (m.type !== MessageType.RPC_METHOD) throw new Error('Invalid message type');

        switch (type) {
            case ThreadTypes.API: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.ZERO_MQ: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.BITCOIN_INDEXER: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.PoA: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.MEMPOOL: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            default:
                this.log(`Unknown thread message received. {Type: ${m.type}}`);
                break;
        }
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
        }, 60000); //clear ever minute
    }

    private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | void> {
        this.info(`Call request received. {To: ${data.to.toString()}, Calldata: ${data.calldata}}`);

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

    //private async getWBTCBalanceOf(address: Address): Promise<WBTCBalanceResponse> {}

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

    private async processAPIMessage(
        message: RPCMessage<BitcoinRPCThreadMessageType>,
    ): Promise<ThreadData | void> {
        const rpcMethod = message.data.rpcMethod;

        switch (rpcMethod) {
            case BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK: {
                return await this.bitcoinRPC.getBlockHeight();
            }

            case BitcoinRPCThreadMessageType.GET_TX: {
                return await this.bitcoinRPC.getRawTransaction(
                    message.data.data as BitcoinRawTransactionParams,
                );
            }

            case BitcoinRPCThreadMessageType.VALIDATE_BLOCK_HEADERS: {
                return await this.validateBlockHeaders(message.data.data as BlockDataAtHeightData);
            }

            case BitcoinRPCThreadMessageType.CALL: {
                return await this.onCallRequest(message.data.data as CallRequestData);
            }

            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE: {
                return await this.broadcastTransaction(message.data.data as string);
            }

            /*case BitcoinRPCThreadMessageType.WBTC_BALANCE_OF: {
                return await this.bitcoinRPC.getWBTCBalanceOf(message.data.data as string);
            }*/

            default:
                this.error(`Unknown API message received. {Type: ${message.type}}`);
                break;
        }
    }
}

new BitcoinRPCThread();
