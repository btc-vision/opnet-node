import { Logger } from '@btc-vision/bsi-common';
import { VMStorage } from '../../../../vm/storage/VMStorage.js';
import { UnwrappedGenerationResult } from '../../../../api/json-rpc/types/interfaces/results/opnet/GenerateResult.js';
import { VaultUTXOs } from '../../../../db/repositories/WBTCUTXORepository.js';
import { VaultUTXOs as AdaptedVaultUTXOs } from '@btc-vision/transaction';
import { DataConverter } from '@btc-vision/bsi-db';

// TODO: Add rate limiting.
export class UnwrapGenerator extends Logger {
    constructor(private readonly storage: VMStorage) {
        super();
    }

    public async generateUnwrapParameters(
        amount: bigint,
        wbtcBalance: bigint,
    ): Promise<UnwrappedGenerationResult> {
        // check if the amount is greater than the balance
        if (amount > wbtcBalance) {
            throw new Error(`Not enough WBTC balance to unwrap ${amount} > ${wbtcBalance}`);
        }

        const utxos = await this.storage.getWBTCUTXOs(amount);
        if (!utxos) {
            throw new Error('No UTXOs found for requested amount');
        }

        return {
            vaultUTXOs: this.convertVaultUTXOsToAdaptedVaultUTXOs(Array.from(utxos.values())),
            balance: `0x${wbtcBalance.toString(16)}`,
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
}
