import { Logger } from '@btc-vision/bsi-common';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import {
    TrustedAuthority,
    TrustedPublicKeysWithConstraints,
} from '../../../../poa/configurations/manager/TrustedAuthority.js';
import { WrappedGenerationResult } from '../../../../api/json-rpc/types/interfaces/results/opnet/GenerateResult.js';
import { Network } from 'bitcoinjs-lib';
import { P2PVersion } from '../../../../poa/configurations/P2PVersion.js';
import { KeyPairGenerator } from '../../../../poa/networking/encryptem/KeyPairGenerator.js';
import { EcKeyPair } from '@btc-vision/transaction';

export interface WrapTransactionParameters {
    readonly amount: bigint;
}

export class WrapTransactionGenerator extends Logger {
    public readonly logColor: string = '#5dbcef';

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();
    private readonly generator: KeyPairGenerator = new KeyPairGenerator();

    constructor(private readonly network: Network) {
        super();
    }

    public async generateWrapParameters(
        params: WrapTransactionParameters,
    ): Promise<WrappedGenerationResult | undefined> {
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
