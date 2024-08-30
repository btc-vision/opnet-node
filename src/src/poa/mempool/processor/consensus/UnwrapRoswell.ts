import { Network, Psbt, Signer } from 'bitcoinjs-lib';
import { FinalizedPSBT, UnwrapConsensus } from './UnwrapConsensus.js';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { WBTCUTXORepository } from '../../../../db/repositories/WBTCUTXORepository.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { Consensus } from '../../../configurations/consensus/Consensus.js';
import {
    UnwrapPSBTDecodedData,
    VerificationVault,
} from '../../verificator/consensus/UnwrapConsensusVerificator.js';
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

        const minimums = this.generateMinimumOrdered(data.vaults, data.hashes);

        this.log(`Attempting to sign unwrap transaction.`);
        for (let vault of data.vaults.values()) {
            const canSign = vault.publicKeys.find((key) => {
                return this.authority.publicKey.equals(key);
            });

            if (!canSign) {
                this.warn(`Cannot sign for vault ${vault.vault}`);
                continue;
            }

            const alreadySigned = MultiSignTransaction.verifyIfSigned(psbt, this.authority.xPubKey);
            if (alreadySigned) {
                this.warn(`Already signed for vault ${vault.vault}`);
                continue;
            }

            this.log(`Signing for vault ${vault.vault}`);

            const signed = MultiSignTransaction.signPartial(psbt, this.signer, 1, minimums);
            if (signed.signed) {
                this.success(
                    `Signed for vault ${vault.vault} - Can be finalized: ${signed.final}}`,
                );

                const pubKeys = this.generatePubKeysOrdered(data.vaults, data.hashes);
                finalized =
                    MultiSignTransaction.attemptFinalizeInputs(psbt, 1, pubKeys, signed.final) &&
                    signed.final;

                if (finalized) {
                    this.success(`Finalized transaction!`);
                }

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
            hash: data.hash,
        };
    }

    private getVaultForHash(
        hash: string,
        vaults: Map<string, VerificationVault>,
    ): VerificationVault {
        for (let vault of vaults.values()) {
            if (vault.utxoDetails.find((utxo) => utxo.hash === hash)) {
                return vault;
            }
        }

        throw new Error(`Vault for hash ${hash} not found.`);
    }

    private generateMinimumOrdered(
        vaults: Map<string, VerificationVault>,
        hashes: string[],
    ): number[] {
        let minimums: number[] = [];

        for (let i = 0; i < hashes.length; i++) {
            const vault = this.getVaultForHash(hashes[i], vaults);
            if (!vault) {
                throw new Error(`Vault ${hashes[i]} not found in vaults.`);
            }

            minimums.push(vault.minimum);
        }

        return minimums;
    }

    private generatePubKeysOrdered(
        vaults: Map<string, VerificationVault>,
        hashes: string[],
    ): Buffer[][] {
        let pubKeys: Buffer[][] = [];

        for (let i = 0; i < hashes.length; i++) {
            const vault = this.getVaultForHash(hashes[i], vaults);
            if (!vault) {
                throw new Error(`Vault ${hashes[i]} not found in vaults.`);
            }

            pubKeys.push(vault.publicKeys);
        }

        return pubKeys;
    }
}
