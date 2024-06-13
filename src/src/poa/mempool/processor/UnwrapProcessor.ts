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
import {
    FromBase64Params,
    PsbtTransaction,
    PsbtTransactionData,
    VaultUTXOs as AdaptedVaultUTXOs,
} from '@btc-vision/transaction';
import { DataConverter } from '@btc-vision/bsi-db';
import { Address } from '@btc-vision/bsi-binary';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';

interface FinalizedPSBT {
    readonly modified: boolean;
    readonly finalized: boolean;
}

export class UnwrapProcessor extends PSBTProcessor<PSBTTypes.UNWRAP> {
    public readonly logColor: string = '#00ffe1';

    public readonly type: PSBTTypes.UNWRAP = PSBTTypes.UNWRAP;

    #rpc: BitcoinRPC | undefined;
    #utxoRepository: WBTCUTXORepository | undefined;

    public constructor(authority: OPNetIdentity, db: ConfigurableDBManager, network: Network) {
        super(authority, db, network);
    }

    private get utxoRepository(): WBTCUTXORepository {
        if (!this.#utxoRepository) throw new Error('UTXO repository not created.');

        return this.#utxoRepository;
    }

    private get rpc(): BitcoinRPC {
        if (!this.#rpc) throw new Error('Bitcoin RPC not created.');

        return this.#rpc;
    }

    public async createRepositories(rpc: BitcoinRPC): Promise<void> {
        if (!this.db.db) throw new Error('Database connection not established.');

        this.#utxoRepository = new WBTCUTXORepository(this.db.db);
        this.#rpc = rpc;
    }

    public async process(psbt: Psbt, data: UnwrapPSBTDecodedData): Promise<PSBTProcessedResponse> {
        try {
            const amountOfInputs = psbt.inputCount;

            let modified: boolean = false;
            let created: boolean = false;
            let finalized: FinalizedPSBT | undefined;
            if (amountOfInputs === 1) {
                const result = await this.selectUTXOs(data.amount, data.receiver, psbt);

                // do something with the utxos.
                psbt = result.newPsbt;

                created = true;
            } else {
                finalized = await this.finalizePSBT(psbt, data.amount, data.receiver);
                modified = finalized.modified;
            }

            return {
                psbt: psbt,
                finalized: finalized?.finalized ?? false,
                modified: modified,
                created: created,
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

        let finalized: boolean = false;
        if (signed) {
            this.success('WBTC PSBT signed!');

            finalized = transaction.attemptFinalizeInputs();
            if (finalized) {
                this.success('WBTC PSBT finalized!');

                // @ts-ignore
                const tx = transaction.transaction;

                const finalized = tx.extractTransaction();
                console.log('final tx', finalized);
            }
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

        const signer: Signer = this.authority.getSigner();

        // add fees.
        const psbtBase64 = psbt.toBase64();
        const transactionParams: FromBase64Params = {
            network: this.network,
            amountRequested: amount,
            receiver: receiver,
            signer: signer,
            feesAddition: amount - 330n,
        };

        const transaction = PsbtTransaction.from(transactionParams);
        transaction.mergeVaults(utxosArray, signer);

        const base64 = transaction.toBase64();
        const merged = await this.rpc.joinPSBTs([psbtBase64, base64]);
        if (!merged) {
            throw new Error('Could not merge PSBTs');
        }

        console.log('MERGED!', merged);

        const resultingBase64 = transaction.toBase64();
        if (psbtBase64 === resultingBase64) {
            throw new Error('No UTXOs were added to the PSBT');
        }

        this.success(`WBTC PSBT adapted with UTXOs`);

        return Psbt.fromBase64(resultingBase64, { network: this.network });
    }
}
