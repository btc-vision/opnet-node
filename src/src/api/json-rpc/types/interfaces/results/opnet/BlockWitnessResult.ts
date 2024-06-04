import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface IBlockWitnessAPI {
    readonly trusted: boolean;
    readonly signature: string;

    readonly identity?: string;
    readonly opnetPubKey?: string;
}

export interface IBlockWitnessResultAPI {
    [key: string]: IBlockWitnessAPI[];
}

export type BlockWitnessResult = JSONRpc2ResultData<JSONRpcMethods.BLOCK_WITNESS> &
    {
        readonly blockNumber: string;
        readonly witnesses: IBlockWitnessAPI[];
    }[];
