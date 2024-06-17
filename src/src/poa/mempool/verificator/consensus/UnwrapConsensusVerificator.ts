import { Consensus } from '../../../configurations/consensus/Consensus.js';
import { Psbt } from 'bitcoinjs-lib';
import { PSBTDecodedData } from '../../psbt/PSBTTransactionVerifier.js';
import { Address } from '@btc-vision/bsi-binary';
import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { TrustedAuthority } from '../../../configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../../../configurations/manager/AuthorityManager.js';

export interface MinimumUtxoInformation {
    readonly hash: string;
    readonly value: bigint;
}

export interface VerificationVault {
    readonly vault: Address;
    readonly publicKeys: Buffer[];
    readonly minimum: number;
    readonly utxoDetails: MinimumUtxoInformation[];
}

export interface UnwrapPSBTDecodedData extends PSBTDecodedData {
    readonly receiver: Address;
    readonly amount: bigint;
    readonly version: number;
    readonly vaults: Map<Address, VerificationVault>;
}

export type PartialUnwrapPSBTDecodedData = Omit<UnwrapPSBTDecodedData, 'vaults'>;

export abstract class UnwrapConsensusVerificator<T extends Consensus> extends Logger {
    public abstract readonly consensus: T;
    public readonly logColor: string = '#008cff';

    protected readonly trustedAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();

    protected constructor(protected readonly db: ConfigurableDBManager) {
        super();
    }

    public abstract createRepositories(): Promise<void>;

    public abstract verify(
        data: PartialUnwrapPSBTDecodedData,
        psbt: Psbt,
    ): Promise<UnwrapPSBTDecodedData>;
}
