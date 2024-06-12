import { PSBTProcessedResponse, PSBTProcessor } from './PSBTProcessor.js';
import { PSBTTypes } from '../psbt/PSBTTypes.js';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Network, Psbt, Signer } from 'bitcoinjs-lib';
import { UnwrapPSBTDecodedData } from '../verificator/UnwrapPSBTVerificator.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import {
    SelectedUTXOs,
    VaultUTXOs,
    WBTCUTXORepository,
} from '../../../db/repositories/WBTCUTXORepository.js';
import { PsbtTransaction, VaultUTXOs as AdaptedVaultUTXOs } from '@btc-vision/transaction';
import {
    FromBase64Params,
    PsbtTransactionData,
} from '@btc-vision/transaction/src/transaction/processor/PsbtTransaction.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { Address } from '@btc-vision/bsi-binary';

interface FinalizedPSBT {
    readonly modified: boolean;
    readonly finalized: boolean;
}

export class UnwrapProcessor extends PSBTProcessor<PSBTTypes.UNWRAP> {
    public readonly logColor: string = '#00ffe1';

    public readonly type: PSBTTypes.UNWRAP = PSBTTypes.UNWRAP;

    #utxoRepository: WBTCUTXORepository | undefined;

    public constructor(authority: OPNetIdentity, db: ConfigurableDBManager, network: Network) {
        super(authority, db, network);
    }

    private get utxoRepository(): WBTCUTXORepository {
        if (!this.#utxoRepository) throw new Error('UTXO repository not created.');

        return this.#utxoRepository;
    }

    public createRepositories(): void {
        if (!this.db.db) throw new Error('Database connection not established.');

        this.#utxoRepository = new WBTCUTXORepository(this.db.db);
    }

    public async process(psbt: Psbt, data: UnwrapPSBTDecodedData): Promise<PSBTProcessedResponse> {
        try {
            const amountOfInputs = psbt.inputCount;

            let modified: boolean;
            let finalized: FinalizedPSBT | undefined;
            if (amountOfInputs === 1) {
                const result = await this.selectUTXOs(data.amount, data.receiver, psbt);

                // do something with the utxos.
                psbt = result.newPsbt;

                modified = true;
            } else {
                finalized = await this.finalizePSBT(psbt, data.amount, data.receiver);
                modified = finalized.modified;
            }

            return {
                psbt: psbt,
                finalized: finalized?.finalized ?? false,
                modified: modified,
            };
        } catch (e) {
            this.error(`Error processing Unwrap PSBT: ${(e as Error).stack}`);
        }

        throw new Error('Error processing Unwrap PSBT');
    }

    /**
     * We must add the UTXOs to the PSBT
     */
    public async selectUTXOs(
        amount: bigint,
        receiver: Address,
        psbt: Psbt,
    ): Promise<{ newPsbt: Psbt; usedUTXOs: SelectedUTXOs }> {
        const utxos = await this.utxoRepository.queryVaultsUTXOs(amount);
        if (!utxos) {
            throw new Error('No UTXOs found for requested amount');
        }

        // We must generate the new psbt.
        const newPsbt = await this.adaptPSBT(psbt, utxos, amount, receiver);

        return {
            newPsbt: newPsbt,
            usedUTXOs: utxos,
        };
    }

    private convertVaultUTXOsToAdaptedVaultUTXOs(utxos: VaultUTXOs[]): AdaptedVaultUTXOs[] {
        const adaptedVaultUTXOs: AdaptedVaultUTXOs[] = [];

        for (const vault of utxos) {
            const adapted: AdaptedVaultUTXOs = {
                vault: vault.vault,
                publicKeys: vault.publicKeys,
                minimum: vault.minimum,
                utxos: vault.utxos.map((utxo) => {
                    return {
                        vault: vault.vault,
                        blockId: DataConverter.fromDecimal128(utxo.blockId),
                        hash: utxo.hash,
                        value: DataConverter.fromDecimal128(utxo.value),
                        outputIndex: utxo.outputIndex,
                        output: utxo.output.toString('base64'),
                    };
                }),
            };

            adaptedVaultUTXOs.push(adapted);
        }

        return adaptedVaultUTXOs;
    }

    private async finalizePSBT(
        psbt: Psbt,
        amount: bigint,
        recevier: Address,
    ): Promise<FinalizedPSBT> {
        // Attempt to sign all inputs.

        const signer: Signer = this.authority.getSigner();
        const transactionParams: PsbtTransactionData = {
            network: this.network,
            amountRequested: amount,
            signer: signer,
            psbt: psbt,
            receiver: recevier,
            feesAddition: amount - 330n,
        };

        const transaction = new PsbtTransaction(transactionParams);
        const signed: boolean = transaction.attemptSignAllInputs();
        const finalized: boolean = transaction.attemptFinalizeInputs();

        if (signed) {
            this.success('WBTC PSBT signed!');
        }

        if (finalized) {
            this.success('WBTC PSBT finalized!');

            // @ts-ignore
            const tx = transaction.transaction;

            const finalized = tx.extractTransaction();
            console.log(finalized);
        }

        return {
            modified: signed,
            finalized: finalized,
        };
    }

    private async adaptPSBT(
        psbt: Psbt,
        utxos: SelectedUTXOs,
        amount: bigint,
        receiver: Address,
    ): Promise<Psbt> {
        const utxosArray = this.convertVaultUTXOsToAdaptedVaultUTXOs(Array.from(utxos.values()));

        // add fees.
        const psbtBase64 = psbt.toBase64();
        const signer: Signer = this.authority.getSigner();
        const transactionParams: FromBase64Params = {
            network: this.network,
            amountRequested: amount,
            receiver: receiver,
            signer: signer,
            feesAddition: amount - 330n,
        };

        const transaction = PsbtTransaction.fromBase64(psbt.toBase64(), transactionParams);
        transaction.mergeVaults(utxosArray, signer);

        const resultingBase64 = transaction.toBase64();
        if (psbtBase64 === resultingBase64) {
            throw new Error('No UTXOs were added to the PSBT');
        }

        this.success(`WBTC PSBT adapted with UTXOs`);

        return Psbt.fromBase64(resultingBase64, { network: this.network });
    }
}
