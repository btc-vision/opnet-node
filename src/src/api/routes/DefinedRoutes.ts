import { Routes } from '../enums/Routes.js';
import { JSONRpcMethods } from '../json-rpc/types/enums/JSONRpcMethods.js';
import { Block } from './api/v1/block/Block.js';
import { HeapBlockRoute } from './api/v1/block/HeapBlock.js';
import { JSONRpc } from './api/v1/json-rpc/JSONRpc.js';
import { ProtobufSchema } from './api/v1/protobuf/ProtobufSchema.js';
import { Route } from './Route.js';

export const DefinedRoutes: { [key in Routes]: Route<key, JSONRpcMethods, unknown> } = {
    [Routes.HEAP_BLOCK]: new HeapBlockRoute(),
    [Routes.PROTOBUF_SCHEMA]: new ProtobufSchema(),
    [Routes.BLOCK]: new Block(),
    [Routes.JSON_RPC]: new JSONRpc(),
};
