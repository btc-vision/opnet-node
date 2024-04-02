import { IBaseDocument } from '@btc-vision/motoswapdb';

export interface IContractKeyPointerDocument extends IBaseDocument {
    readonly contractAddress: string;
    readonly key: string;
    readonly pointer: string;
}
