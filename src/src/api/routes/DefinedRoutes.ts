import { Routes } from '../enums/Routes.js';
import { JSONRpcMethods } from '../json-rpc/types/enums/JSONRpcMethods.js';
import { GetBalanceRoute } from './api/v1/address/GetBalanceRoute.js';
import { UTXOsRoute } from './api/v1/address/UTXOsRoute.js';
import { BlockByHash } from './api/v1/block/BlockByHash.js';
import { BlockByNumber } from './api/v1/block/BlockByNumber.js';
import { LatestBlock } from './api/v1/block/LatestBlock.js';
import { ChainId } from './api/v1/chain/ChainId.js';
import { ReorgRoute } from './api/v1/chain/ReorgRoute.js';
import { JSONRpc } from './api/v1/json-rpc/JSONRpc.js';
import { NotImplemented } from './api/v1/not-implemented/NotImplemented.js';
import { OPNetWitnessRoute } from './api/v1/opnet/OPNetWitnessRoute.js';
import { ProtobufSchema } from './api/v1/protobuf/ProtobufSchema.js';
import { ProtobufAPISchema } from './api/v1/protobuf/ProtobufAPISchema.js';
import { Call } from './api/v1/states/Call.js';
import { GetCode } from './api/v1/states/GetCode.js';
import { GetStorageAt } from './api/v1/states/GetStorageAt.js';
import { TransactionByHash } from './api/v1/transaction/TransactionByHash.js';
import { TransactionReceipt } from './api/v1/transaction/TransactionReceipt.js';
import { Route } from './Route.js';
import { BroadcastTransaction } from './api/v1/transaction/BroadcastTransaction.js';
import { GasRoute } from './api/v1/block/GasRoute.js';
import { PublicKeyInfoRoute } from './api/v1/address/PublicKeyInfoRoute.js';
import { GetPreimage } from './api/v1/transaction/GetPreimage.js';
import { LatestEpoch } from './api/v1/epochs/LatestEpoch.js';
import { EpochByNumber } from './api/v1/epochs/EpochByNumber.js';
import { EpochByHash } from './api/v1/epochs/EpochByHash.js';
import { SubmitEpochRoute } from './api/v1/epochs/SubmitEpochRoute.js';
import { GetEpochTemplateRoute } from './api/v1/epochs/GetEpochTemplateRoute.js';
import { BlockByChecksum } from './api/v1/block/BlockByChecksum.js';

export const DefinedRoutes: {
    [key in Routes]: Route<key, JSONRpcMethods, object | string | undefined>;
} = {
    /** Blocks */
    [Routes.LATEST_BLOCK]: new LatestBlock(),
    [Routes.BLOCK_BY_ID]: new BlockByNumber(),
    [Routes.BLOCK_BY_HASH]: new BlockByHash(),
    [Routes.BLOCK_BY_CHECKSUM]: new BlockByChecksum(),
    [Routes.BLOCK_WITNESS]: new OPNetWitnessRoute(),
    [Routes.GAS]: new GasRoute(),

    /** Epochs */
    [Routes.LATEST_EPOCH]: new LatestEpoch(),
    [Routes.EPOCH_BY_NUMBER]: new EpochByNumber(),
    [Routes.EPOCH_BY_HASH]: new EpochByHash(),
    [Routes.EPOCH_TEMPLATE]: new GetEpochTemplateRoute(),
    [Routes.SUBMIT_EPOCH]: new SubmitEpochRoute(),

    /** Address */
    [Routes.UTXOS]: new UTXOsRoute(),
    [Routes.GET_BALANCE]: new GetBalanceRoute(),
    [Routes.PUBLIC_KEY_INFO]: new PublicKeyInfoRoute(),

    /** States */
    [Routes.GET_STORAGE_AT]: new GetStorageAt(),
    [Routes.GET_CODE]: new GetCode(),
    [Routes.CALL]: new Call(),

    /** Chain */
    [Routes.CHAIN_ID]: new ChainId(),
    [Routes.REORG]: new ReorgRoute(),

    /** Transactions */
    [Routes.TRANSACTION_BY_HASH]: new TransactionByHash(),
    [Routes.TRANSACTION_RECEIPT]: new TransactionReceipt(),
    [Routes.BROADCAST_TRANSACTION]: new BroadcastTransaction(),
    [Routes.TRANSACTION_PREIMAGE]: new GetPreimage(),

    /** Others */
    [Routes.PROTOBUF_SCHEMA]: new ProtobufSchema(),
    [Routes.PROTOBUF_API_SCHEMA]: new ProtobufAPISchema(),
    [Routes.JSON_RPC]: new JSONRpc(),

    [Routes.NOT_IMPLEMENTED]: new NotImplemented(),
};
