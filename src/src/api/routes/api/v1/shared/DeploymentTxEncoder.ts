import { IContractAPIDocument } from '../../../../../db/documents/interfaces/IContractDocument.js';
import { ContractInformation } from '../../../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { VMStorage } from '../../../../../vm/storage/VMStorage.js';
import {
    DeploymentTransactionDocument,
    TransactionDocument,
} from '../../../../../db/interfaces/ITransactionDocument.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionDocumentForAPI } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';

export class DeploymentTxEncoder {
    public async addDeploymentData(
        tx: TransactionDocumentForAPI<OPNetTransactionTypes>,
        height: bigint,
        storage: VMStorage,
    ): Promise<TransactionDocumentForAPI<OPNetTransactionTypes>> {
        if (tx.OPNetType !== OPNetTransactionTypes.Deployment) {
            return tx;
        }

        if (!storage) {
            throw new Error('Storage not initialized');
        }

        const txDeployment =
            tx as unknown as TransactionDocument<OPNetTransactionTypes> as DeploymentTransactionDocument;

        const contractData = await this.getContractData(
            txDeployment.contractAddress,
            height + 1n,
            storage,
        );

        if (contractData) {
            tx = {
                ...tx,
                ...contractData,
                contractTweakedPublicKey: contractData.contractTweakedPublicKey
                    ? contractData.contractTweakedPublicKey.toString('base64')
                    : '',
                deployedTransactionHash: undefined,
                deployedTransactionId: undefined,
            };

            delete tx.deployedTransactionId;
            delete tx.deployedTransactionHash;
        }

        return tx;
    }

    private async getContractData(
        contractAddress: string,
        height: bigint,
        storage: VMStorage,
    ): Promise<IContractAPIDocument | undefined> {
        const transactions: ContractInformation | undefined = await storage.getContractAt(
            contractAddress,
            height,
        );

        if (!transactions) return undefined;

        return this.convertToBlockHeaderAPIDocument(transactions);
    }

    private convertToBlockHeaderAPIDocument(data: ContractInformation): IContractAPIDocument {
        const document: IContractAPIDocument = {
            ...data,
            contractTweakedPublicKey: Buffer.from(data.contractTweakedPublicKey.buffer).toString(
                'base64',
            ),
            bytecode: data.bytecode.toString('base64'),
            deployerPubKey: data.deployerPubKey.toString('base64'),
            contractSeed: data.contractSeed.toString('base64'),
            contractSaltHash: data.contractSaltHash.toString('hex'),
            blockHeight: undefined,
            deployerAddress: undefined,
            _id: undefined,
        };

        delete document.deployerAddress;
        delete document.blockHeight;
        delete document._id;

        return document;
    }
}
