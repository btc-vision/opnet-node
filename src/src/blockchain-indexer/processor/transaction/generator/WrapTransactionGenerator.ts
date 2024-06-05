import { BitcoinNetwork, Logger } from '@btc-vision/bsi-common';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import {
    TrustedAuthority,
    TrustedPublicKeysWithConstraints,
} from '../../../../poa/configurations/manager/TrustedAuthority.js';
import { GeneratedResult } from '../../../../api/json-rpc/types/interfaces/results/opnet/GenerateResult.js';
import { Network, networks } from 'bitcoinjs-lib';
import { EcKeyPair } from '@btc-vision/bsi-transaction';
import { P2PVersion } from '../../../../poa/configurations/P2PVersion.js';

export interface WrapTransactionParameters {
    readonly amount: bigint;
}

export class WrapTransactionGenerator extends Logger {
    public readonly logColor: string = '#5dbcef';

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();
    private readonly wbtcContractAddress: string = this.currentAuthority.WBTC_CONTRACT_ADDRESS;

    private readonly network: Network;

    constructor(bitcoinNetwork: BitcoinNetwork) {
        super();

        /** Move this to its own class with all the duplicates */
        switch (bitcoinNetwork) {
            case BitcoinNetwork.Mainnet:
                this.network = networks.bitcoin;
                break;
            case BitcoinNetwork.Regtest:
                this.network = networks.regtest;
                break;
            case BitcoinNetwork.TestNet:
                this.network = networks.testnet;
                break;
            default:
                throw new Error(`Invalid network: ${bitcoinNetwork}`);
        }
    }

    public async generateWrapParameters(
        _params: WrapTransactionParameters,
    ): Promise<GeneratedResult | undefined> {
        this.log(`Generating wrap transaction... (WBTC: ${this.wbtcContractAddress})`);

        const trustedValidators: TrustedPublicKeysWithConstraints =
            this.currentAuthority.trustedPublicKeysRespectingConstraints;

        if (!trustedValidators) return;

        // TODO: Add a signature that prove the authority of the generated parameters
        const signature: string = '';

        return {
            keys: trustedValidators.keys.map((validator) => validator.toString('base64')),
            vault: this.generateVaultAddress(
                trustedValidators.keys,
                trustedValidators.constraints.minimum,
            ),
            entities: trustedValidators.entities,
            signature: signature,
            constraints: {
                timestamp: Date.now(),
                version: P2PVersion,
                minimum: trustedValidators.constraints.minimum,
                transactionMinimum: trustedValidators.constraints.minimumSignatureRequired,
            },
        };
    }

    private generateVaultAddress(keys: Buffer[], minimumSignatureRequired: number): string {
        return EcKeyPair.generateMultiSigAddress(keys, minimumSignatureRequired, this.network);
    }
}
