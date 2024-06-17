import { PSBTProcessedResponse, PSBTProcessor } from './PSBTProcessor.js';
import { PSBTTypes } from '../psbt/PSBTTypes.js';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Network, Psbt } from 'bitcoinjs-lib';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { WBTCUTXORepository } from '../../../db/repositories/WBTCUTXORepository.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { FinalizedPSBT } from './consensus/UnwrapConsensus.js';
import { Consensus } from '../../configurations/consensus/Consensus.js';
import { UnwrapRoswell } from './consensus/UnwrapRoswell.js';
import { UnwrapPSBTDecodedData } from '../verificator/consensus/UnwrapConsensusVerificator.js';

export class UnwrapProcessor extends PSBTProcessor<PSBTTypes.UNWRAP> {
    public readonly logColor: string = '#00ffe1';

    public readonly type: PSBTTypes.UNWRAP = PSBTTypes.UNWRAP;

    #roswell: UnwrapRoswell | undefined;
    #rpc: BitcoinRPC | undefined;
    #utxoRepository: WBTCUTXORepository | undefined;

    public constructor(authority: OPNetIdentity, db: ConfigurableDBManager, network: Network) {
        super(authority, db, network);
    }

    private get utxoRepository(): WBTCUTXORepository {
        if (!this.#utxoRepository) throw new Error('UTXO repository not created.');

        return this.#utxoRepository;
    }

    private get rpc(): BitcoinRPC {
        if (!this.#rpc) throw new Error('Bitcoin RPC not created.');

        return this.#rpc;
    }

    private get roswell(): UnwrapRoswell {
        if (!this.#roswell) throw new Error('Roswell consensus not created.');

        return this.#roswell;
    }

    public async createRepositories(rpc: BitcoinRPC): Promise<void> {
        if (!this.db.db) throw new Error('Database connection not established.');

        this.#utxoRepository = new WBTCUTXORepository(this.db.db);
        this.#rpc = rpc;

        this.#roswell = new UnwrapRoswell(
            this.authority,
            this.utxoRepository,
            this.rpc,
            this.network,
        );
    }

    public async process(psbt: Psbt, data: UnwrapPSBTDecodedData): Promise<PSBTProcessedResponse> {
        let modified: boolean = false;
        let finalized: FinalizedPSBT | undefined;

        switch (data.version) {
            case Consensus.Roswell:
                finalized = await this.roswell.finalizePSBT(psbt, data);
                break;
        }

        return {
            psbt: psbt,
            finalized: finalized?.finalized ?? false,
            modified: modified,
        };
    }
}
