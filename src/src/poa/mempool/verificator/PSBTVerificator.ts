import { Logger } from '@btc-vision/bsi-common';
import { PSBTTypes } from '../psbt/PSBTTypes.js';
import { Network, networks, Psbt } from 'bitcoinjs-lib';
import { KnownPSBTObject } from '../psbt/PSBTTransactionVerifier.js';

export abstract class PSBTVerificator<T extends PSBTTypes> extends Logger {
    public abstract readonly type: T;

    public readonly logColor: string = '#e0e0e0';

    protected constructor(protected readonly network: Network = networks.bitcoin) {
        super();
    }

    public abstract verify(data: Psbt): Promise<KnownPSBTObject | false>;
}
