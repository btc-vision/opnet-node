import { IBaseDocument } from '@btc-vision/motoswapcommon';

export interface IBlockchainInformationDocument extends IBaseDocument {
    network: string;
    lastProcessedBlock: number;
    inProgressBlock: number;
    toRescanBlock: number[];
}
