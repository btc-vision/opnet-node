import { IBaseDocument } from '@btc-vision/motoswapcommon';
import { Binary } from 'mongodb';

export interface IContractPointerValueDocument extends IBaseDocument {
    readonly contractAddress: string;
    readonly pointer: Binary;
    readonly value: Binary;
}
