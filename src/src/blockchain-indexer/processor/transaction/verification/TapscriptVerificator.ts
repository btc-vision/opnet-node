import { networks, opcodes, Payment, payments, script } from 'bitcoinjs-lib';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';
import { Taptree } from 'bitcoinjs-lib/src/types.js';
import { DeploymentGenerator } from '@btc-vision/transaction';

export interface ContractAddressVerificationParams {
    deployerPubKeyXOnly: Buffer;
    contractSaltPubKey: Buffer;
    originalSalt: Buffer;
    bytecode: Buffer;
    network?: networks.Network;
}

export class TapscriptVerificator {
    private static readonly LOCK_LEAF_SCRIPT: Buffer = script.compile([opcodes.OP_0]);
    private static readonly TAP_SCRIPT_VERSION: number = 192;

    public static getContractAddress(
        params: ContractAddressVerificationParams,
    ): string | undefined {
        const network = params.network || networks.bitcoin;
        const scriptBuilder: DeploymentGenerator = new DeploymentGenerator(
            params.deployerPubKeyXOnly,
            toXOnly(params.contractSaltPubKey),
            network,
        );
        const compiledTargetScript: Buffer = scriptBuilder.compile(
            params.bytecode,
            params.originalSalt,
        );

        const scriptTree: Taptree = [
            {
                output: compiledTargetScript,
                version: TapscriptVerificator.TAP_SCRIPT_VERSION,
            },
            {
                output: TapscriptVerificator.LOCK_LEAF_SCRIPT,
                version: TapscriptVerificator.TAP_SCRIPT_VERSION,
            },
        ];

        const transactionData: Payment = {
            internalPubkey: params.deployerPubKeyXOnly,
            network: network,
            scriptTree: scriptTree,
        };

        const tx: Payment = payments.p2tr(transactionData);
        return tx.address;
    }
}
