import { BaseModel } from '@btc-vision/bsi-common';
import { IBlockchainInformationDocument } from '../documents/interfaces/IBlockchainInformationDocument.js';

export class BlockchainInformation extends BaseModel {
    public network: string;
    public inProgressBlock: number;

    constructor(readonly document: IBlockchainInformationDocument) {
        super();
        this.network = document.network;
        this.inProgressBlock = document.inProgressBlock;
    }

    public toDocument(): Readonly<IBlockchainInformationDocument> {
        const document: IBlockchainInformationDocument = {
            network: this.network,
            inProgressBlock: this.inProgressBlock,
        };

        return document;
    }
}
