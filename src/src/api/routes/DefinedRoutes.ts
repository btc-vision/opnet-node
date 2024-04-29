import { Routes } from '../enums/Routes.js';
import { Block } from './api/v1/block/Block.js';
import { HeapBlockRoute } from './api/v1/block/HeapBlock.js';
import { ProtobufSchema } from './api/v1/protobuf/ProtobufSchema.js';
import { Route } from './Route.js';

export const DefinedRoutes: { [key in Routes]: Route<key, unknown> } = {
    [Routes.HEAP_BLOCK]: new HeapBlockRoute(),
    [Routes.PROTOBUF_SCHEMA]: new ProtobufSchema(),
    [Routes.BLOCK]: new Block(),
};
