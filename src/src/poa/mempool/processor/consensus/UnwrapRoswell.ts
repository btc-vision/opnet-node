import { Network, Psbt, Signer } from 'bitcoinjs-lib';
import { FinalizedPSBT, UnwrapConsensus } from './UnwrapConsensus.js';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { MultiSignTransaction } from '@btc-vision/transaction';
import { WBTCUTXORepository } from '../../../../db/repositories/WBTCUTXORepository.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { Consensus } from '../../../configurations/consensus/Consensus.js';
import { UnwrapPSBTDecodedData } from '../../verificator/consensus/UnwrapConsensusVerificator.js';

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

        this.log(`Attempting to sign unwrap transaction.`);
        const signed = MultiSignTransaction.signPartial(
            psbt,
            this.signer,
            1,
            this.trustedAuthority.minimum,
        );

        this.info(`Signed PSBT: ${signed.signed}, is final: ${signed.final}`);

        return {
            modified: signed.signed,
            finalized: false,
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
