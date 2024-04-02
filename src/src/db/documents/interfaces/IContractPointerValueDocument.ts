import { Binary } from 'mongodb';
import { IBaseDocument } from '@btc-vision/motoswapdb';

export interface IContractPointerValueDocument {
    readonly contractAddress: string;
    readonly pointer: Binary;
    readonly value: Binary;
}
