import { toBase64, toHex } from '@btc-vision/bitcoin';
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
                contractPublicKey: contractData.contractPublicKey
                    ? contractData.contractPublicKey.toString('base64')
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
        return {
            contractAddress: data.contractAddress,
            contractPublicKey: toBase64(data.contractPublicKey.toBuffer()),
            deployedTransactionId: toHex(data.deployedTransactionId),
            deployedTransactionHash: toHex(data.deployedTransactionHash),
            bytecode: toBase64(data.bytecode),
            deployerPubKey: toBase64(data.deployerPubKey),
            contractSeed: toBase64(data.contractSeed),
            contractSaltHash: toHex(data.contractSaltHash),
            wasCompressed: data.wasCompressed,
            deployerAddress: data.deployerAddress.toHex(),
        };
    }
}
