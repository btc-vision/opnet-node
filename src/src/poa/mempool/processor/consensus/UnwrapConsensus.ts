import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { Network, Psbt } from 'bitcoinjs-lib';
import { Logger } from '@btc-vision/bsi-common';
import { WBTCUTXORepository } from '../../../../db/repositories/WBTCUTXORepository.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { Consensus } from '../../../configurations/consensus/Consensus.js';
import { UnwrapPSBTDecodedData } from '../../verificator/consensus/UnwrapConsensusVerificator.js';
import { TrustedAuthority } from '../../../configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../../../configurations/manager/AuthorityManager.js';

export interface FinalizedPSBT {
    readonly modified: boolean;
    readonly finalized: boolean;
    readonly hash: string;
}

export abstract class UnwrapConsensus<T extends Consensus> extends Logger {
    public abstract readonly consensus: T;
    public readonly logColor: string = '#6600ff';

    protected readonly trustedAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();

    protected constructor(
        protected readonly authority: OPNetIdentity,
        protected readonly utxoRepository: WBTCUTXORepository,
        protected readonly rpc: BitcoinRPC,
        protected readonly network: Network,
    ) {
        super();
    }

    public abstract finalizePSBT(psbt: Psbt, data: UnwrapPSBTDecodedData): Promise<FinalizedPSBT>;
}
