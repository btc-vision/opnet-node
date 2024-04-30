import { Routes } from '../../enums/Routes.js';
import { JSONRpcMethods } from '../types/enums/JSONRpcMethods.js';

type JSONRpcRoute = { [key in JSONRpcMethods]: Routes };

export const JSONRpcRouteMethods: JSONRpcRoute = {
    [JSONRpcMethods.BLOCK_BY_ID]: Routes.BLOCK,
    [JSONRpcMethods.BLOCK_HEIGHT_BY_ID]: Routes.HEAP_BLOCK,
};
