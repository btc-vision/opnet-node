import { Routes } from '../enums/Routes.js';
import { HeapBlockRoute } from './api/v1/block/HeapBlock.js';
import { ProtobufSchema } from './api/v1/protobuf/ProtobufSchema.js';
import { Route } from './Route.js';

export const DefinedRoutes: { [key in Routes]: Route<key> } = {
    [Routes.HEAP_BLOCK]: new HeapBlockRoute(),
    [Routes.PROTOBUF_SCHEMA]: new ProtobufSchema(),
};
