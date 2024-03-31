import { Routes } from '../enums/Routes.js';
import { HeapBlockRoute } from './HeapBlock.js';
import { ProtobufSchema } from './ProtobufSchema.js';
import { Route } from './Route.js';

export const DefinedRoutes: { [key in Routes]: Route<key> } = {
    [Routes.HEAP_BLOCK]: new HeapBlockRoute(),
    [Routes.PROTOBUF_SCHEMA]: new ProtobufSchema(),
};
