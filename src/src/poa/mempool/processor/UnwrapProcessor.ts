import { PSBTProcessor } from './PSBTProcessor.js';
import { PSBTTypes } from '../psbt/PSBTTypes.js';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Network, Psbt } from 'bitcoinjs-lib';
import { UnwrapPSBTDecodedData } from '../verificator/UnwrapPSBTVerificator.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { WBTCUTXORepository } from '../../../db/repositories/WBTCUTXORepository.js';

export class UnwrapProcessor extends PSBTProcessor<PSBTTypes.UNWRAP> {
    public readonly logColor: string = '#00ffe1';

    public readonly type: PSBTTypes.UNWRAP = PSBTTypes.UNWRAP;

    #utxoRepository: WBTCUTXORepository | undefined;

    public constructor(authority: OPNetIdentity, db: ConfigurableDBManager, network: Network) {
        super(authority, db, network);
    }

    private get utxoRepository(): WBTCUTXORepository {
        if (!this.#utxoRepository) throw new Error('UTXO repository not created.');

        return this.#utxoRepository;
    }

    public createRepositories(): void {
        if (!this.db.db) throw new Error('Database connection not established.');

        this.#utxoRepository = new WBTCUTXORepository(this.db.db);
    }

    public async process(psbt: Psbt, data: UnwrapPSBTDecodedData): Promise<boolean> {
        if (!this.#utxoRepository) throw new Error('UTXO repository not created.');

        this.log(`Processing Unwrap PSBT:`);
        console.log(psbt, data);

        const utxos = await this.#utxoRepository.queryVaultsUTXOs(data.amount);
        console.log(utxos);

        return false;
    }
}
