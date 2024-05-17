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

export class BitcoinRPCThread extends Thread<ThreadTypes.BITCOIN_RPC> {
    public readonly threadType: ThreadTypes.BITCOIN_RPC = ThreadTypes.BITCOIN_RPC;

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly vmManager: VMManager = new VMManager(Config, true);

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
        await this.vmManager.init();
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
            default:
                this.log(`Unknown thread message received. {Type: ${m.type}}`);
                break;
        }
    }

    private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | void> {
        this.info(`Call request received. {To: ${data.to.toString()}, Calldata: ${data.calldata}}`);

        if (!this.vmManager.initiated) {
            return {
                error: 'Not ready to process call requests',
            };
        }

        let result: CallRequestResponse | void;
        try {
            result = await this.vmManager.execute(data.to, data.calldata);
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

        const hasValidProofs: boolean | null = await this.vmManager
            .validateBlockChecksum(vmBlockHeader)
            .catch((e) => {
                console.log(e);
                return null;
            });

        const fetchedBlockHeader = await this.vmManager.getBlockHeader(blockNumber).catch(() => {
            return null;
        });

        return {
            hasValidProofs: hasValidProofs,
            storedBlockHeader: fetchedBlockHeader ?? null,
        };
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

            default:
                this.error(`Unknown API message received. {Type: ${message.type}}`);
                break;
        }
    }
}

new BitcoinRPCThread();
