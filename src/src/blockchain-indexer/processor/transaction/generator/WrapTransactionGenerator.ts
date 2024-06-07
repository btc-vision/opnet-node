import { BitcoinNetwork, Logger } from '@btc-vision/bsi-common';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import {
    TrustedAuthority,
    TrustedPublicKeysWithConstraints,
} from '../../../../poa/configurations/manager/TrustedAuthority.js';
import { GeneratedResult } from '../../../../api/json-rpc/types/interfaces/results/opnet/GenerateResult.js';
import { Network, networks } from 'bitcoinjs-lib';
import { P2PVersion } from '../../../../poa/configurations/P2PVersion.js';
import { KeyPairGenerator } from '../../../../poa/networking/encryptem/KeyPairGenerator.js';
import { EcKeyPair } from '@btc-vision/transaction';

export interface WrapTransactionParameters {
    readonly amount: bigint;
}

export class WrapTransactionGenerator extends Logger {
    public readonly logColor: string = '#5dbcef';

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();
    private readonly wbtcContractAddress: string = this.currentAuthority.WBTC_CONTRACT_ADDRESS;

    private readonly network: Network;
    private readonly generator: KeyPairGenerator = new KeyPairGenerator();

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
        params: WrapTransactionParameters,
    ): Promise<GeneratedResult | undefined> {
        this.log(`Generating wrap transaction... (WBTC: ${this.wbtcContractAddress})`);

        const trustedValidators: TrustedPublicKeysWithConstraints =
            this.currentAuthority.trustedPublicKeysRespectingConstraints;

        if (!trustedValidators) return;

        // TODO: Add a signature that prove the authority of the generated parameters
        const timestamp: number = Date.now();
        const vaultAddress: string = this.generateVaultAddress(
            trustedValidators.keys,
            trustedValidators.constraints.minimum,
        );

        const salt: Buffer = this.generateChecksumSalt(
            trustedValidators,
            params.amount,
            vaultAddress,
            timestamp,
        );

        const checksum: string = this.generator.opnetHash(salt);
        return {
            keys: trustedValidators.keys.map((validator) => validator.toString('base64')),
            vault: vaultAddress,
            entities: trustedValidators.entities,
            signature: checksum,
            constraints: {
                timestamp: timestamp,
                version: P2PVersion,
                minimum: trustedValidators.constraints.minimum,
                transactionMinimum: trustedValidators.constraints.minimumSignatureRequired,
            },
        };
    }

    private generateChecksumSalt(
        trustedValidators: TrustedPublicKeysWithConstraints,
        amount: bigint,
        vault: string,
        timestamp: number,
    ): Buffer {
        const params: Buffer = Buffer.alloc(12 + P2PVersion.length);
        params.writeBigInt64BE(BigInt(timestamp), 0);
        params.writeInt16BE(trustedValidators.constraints.minimum, 8);
        params.writeInt16BE(trustedValidators.constraints.minimumSignatureRequired, 10);
        params.write(P2PVersion, 12, P2PVersion.length, 'utf-8');

        return Buffer.concat([
            ...trustedValidators.keys,
            ...trustedValidators.entities.map((entity) => Buffer.from(entity, 'utf-8')),
            params,
            Buffer.from(amount.toString(), 'utf-8'),
            Buffer.from(vault, 'utf-8'),
        ]);
    }

    private generateVaultAddress(keys: Buffer[], minimumSignatureRequired: number): string {
        return EcKeyPair.generateMultiSigAddress(keys, minimumSignatureRequired, this.network);
    }
}
