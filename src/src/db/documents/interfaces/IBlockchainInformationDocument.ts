import { IBaseDocument } from '@btc-vision/bsi-common';

export interface IBlockchainInformationDocument extends IBaseDocument {
    network: string;
    lastProcessedBlock: number;
    inProgressBlock: number;
    toRescanBlock: number[];
}
