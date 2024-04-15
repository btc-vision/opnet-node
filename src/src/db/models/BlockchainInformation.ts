import { BaseModel } from '@btc-vision/bsi-common';
import { IBlockchainInformationDocument } from '../documents/interfaces/IBlockchainInformationDocument.js';

export class BlockchainInformation extends BaseModel {
    public network: string;
    public lastProcessedBlock: number;
    public inProgressBlock: number;
    public toRescanBlock: number[];

    constructor(readonly document: IBlockchainInformationDocument) {
        super();
        this.network = document.network;
        this.inProgressBlock = document.inProgressBlock;
        this.lastProcessedBlock = document.lastProcessedBlock;
        this.toRescanBlock = document.toRescanBlock;
    }

    public toDocument(): Readonly<IBlockchainInformationDocument> {
        const document: IBlockchainInformationDocument = {
            network: this.network,
            inProgressBlock: this.inProgressBlock,
            lastProcessedBlock: this.lastProcessedBlock,
            toRescanBlock: this.toRescanBlock,
        };

        return document;
    }
}
