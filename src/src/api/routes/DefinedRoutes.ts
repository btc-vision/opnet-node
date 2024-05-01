import { Routes } from '../enums/Routes.js';
import { JSONRpcMethods } from '../json-rpc/types/enums/JSONRpcMethods.js';
import { BlockByHash } from './api/v1/block/BlockByHash.js';
import { BlockById } from './api/v1/block/BlockById.js';
import { LatestBlock } from './api/v1/block/LatestBlock.js';
import { JSONRpc } from './api/v1/json-rpc/JSONRpc.js';
import { NotImplemented } from './api/v1/not-implemented/NotImplemented.js';
import { ProtobufSchema } from './api/v1/protobuf/ProtobufSchema.js';
import { Route } from './Route.js';

export const DefinedRoutes: { [key in Routes]: Route<key, JSONRpcMethods, unknown> } = {
    [Routes.LATEST_BLOCK]: new LatestBlock(),
    [Routes.PROTOBUF_SCHEMA]: new ProtobufSchema(),
    [Routes.BLOCK_BY_ID]: new BlockById(),
    [Routes.BLOCK_BY_HASH]: new BlockByHash(),
    [Routes.JSON_RPC]: new JSONRpc(),
    [Routes.NOT_IMPLEMENTED]: new NotImplemented(),
};
