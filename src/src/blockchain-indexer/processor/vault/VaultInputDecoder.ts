import { TransactionInput } from '../transaction/inputs/TransactionInput.js';
import bitcoin, { opcodes } from 'bitcoinjs-lib';
import { AuthorityManager } from '../../../poa/configurations/manager/AuthorityManager.js';
import { PublicAuthorityKey } from '../../../poa/configurations/manager/TrustedAuthority.js';

type TapScript = (number | Buffer)[];

export interface VaultInput {
    readonly transaction: string;
    readonly keys: PublicAuthorityKey[];
}

export interface InputVault {
    readonly isVault: boolean;
    readonly keys: PublicAuthorityKey[];
}

export class VaultInputDecoder {
    constructor() {}

    public decodeInput(input: TransactionInput): VaultInput | undefined {
        if (!input.originalTransactionId) return;

        const isTaproot = input.transactionInWitness.length > 4; // we need more than 5 elements for an opnet vault script
        if (!isTaproot) {
            return;
        }

        const controlBlockStr = input.transactionInWitness[input.transactionInWitness.length - 1];
        if (!controlBlockStr) {
            return;
        }

        const script = input.transactionInWitness[input.transactionInWitness.length - 2];
        if (!script) {
            return;
        }

        let decodedScript: TapScript | null;
        try {
            decodedScript = bitcoin.script.decompile(Buffer.from(script, 'hex'));
        } catch (e) {
            return;
        }

        if (!decodedScript) {
            return;
        }

        try {
            // Check if the script is a vault script
            const vault = this.isVaultScript(decodedScript);
            if (!vault || !vault.isVault) {
                return;
            }

            return {
                transaction: input.originalTransactionId,
                keys: vault.keys,
            };
        } catch (e) {
            return;
        }
    }

    private isVaultScript(decodedScript: TapScript): InputVault | undefined {
        let wasSigAdd: boolean = false;
        let validVaultPubKeys: boolean | undefined;
        let pubKeys: PublicAuthorityKey[] = [];

        for (const opcodeOrBuffer of decodedScript) {
            if (opcodeOrBuffer === opcodes.OP_CHECKSIGADD) {
                wasSigAdd = true;
                continue;
            }

            if (!wasSigAdd) {
                continue;
            }

            if (opcodeOrBuffer instanceof Buffer) {
                const trustedPublicKey = AuthorityManager.isOrWasTrustedPublicKey(opcodeOrBuffer);
                if (!trustedPublicKey) {
                    validVaultPubKeys = false;
                    break;
                }

                validVaultPubKeys = true;
                pubKeys.push(trustedPublicKey);
            }

            wasSigAdd = false;
        }

        return validVaultPubKeys
            ? {
                  isVault: validVaultPubKeys,
                  keys: pubKeys,
              }
            : undefined;
    }
}
