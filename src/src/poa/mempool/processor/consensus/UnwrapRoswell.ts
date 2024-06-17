import { Network, Psbt, Signer } from 'bitcoinjs-lib';
import { FinalizedPSBT, UnwrapConsensus } from './UnwrapConsensus.js';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { WBTCUTXORepository } from '../../../../db/repositories/WBTCUTXORepository.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { Consensus } from '../../../configurations/consensus/Consensus.js';
import { UnwrapPSBTDecodedData } from '../../verificator/consensus/UnwrapConsensusVerificator.js';
import { MultiSignTransaction } from '@btc-vision/transaction';

export class UnwrapRoswell extends UnwrapConsensus<Consensus.Roswell> {
    public readonly consensus: Consensus.Roswell = Consensus.Roswell;
    private readonly signer: Signer;

    constructor(
        authority: OPNetIdentity,
        utxoRepository: WBTCUTXORepository,
        rpc: BitcoinRPC,
        network: Network,
    ) {
        super(authority, utxoRepository, rpc, network);

        this.signer = this.authority.getSigner();
    }

    /**
     * Taproot!
     * @private
     * @returns {Promise<FinalizedPSBT>} - The finalized PSBT
     */
    public async finalizePSBT(psbt: Psbt, data: UnwrapPSBTDecodedData): Promise<FinalizedPSBT> {
        // Attempt to sign all inputs.
        let modified: boolean = false;
        let finalized: boolean = false;

        this.log(`Attempting to sign unwrap transaction.`);
        for (let vault of data.vaults.values()) {
            const canSign = vault.publicKeys.find((key) => {
                return this.authority.publicKey.equals(key);
            });

            if (!canSign) {
                this.warn(`Cannot sign for vault ${vault.vault}`);
                continue;
            }

            this.log(`Signing for vault ${vault.vault}`);

            const signed = MultiSignTransaction.signPartial(psbt, this.signer, 1, vault.minimum);
            if (signed.signed) {
                this.success(
                    `Signed for vault ${vault.vault} - Can be finalized: ${signed.final}}`,
                );
                modified = true;
            } else {
                this.panic(
                    `Failed to sign for vault ${vault.vault} when it should have been possible.`,
                );
            }
        }

        return {
            modified: modified,
            finalized: finalized,
        };
    }

    /**
     * If we ever need segwit support, we can use this function.
     * @deprecated
     */
    /*private async finalizePSBTSegwit(
        psbt: Psbt,
        amount: bigint,
        recevier: Address,
    ): Promise<FinalizedPSBT> {
        // Attempt to sign all inputs.

        const signer: Signer = this.authority.getSigner();
        const transactionParams: PsbtTransactionData = {
            network: this.network,
            signer: signer,
            psbt: psbt,
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
    }*/
}
