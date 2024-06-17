import { PSBTTypes } from './PSBTTypes.js';
import { Network, networks, Psbt } from 'bitcoinjs-lib';
import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { PSBTVerificator } from '../verificator/PSBTVerificator.js';
import { UnwrapPSBTVerificator } from '../verificator/UnwrapPSBTVerificator.js';

export interface PSBTDecodedData {}

export interface KnownPSBTObject {
    readonly type: PSBTTypes;
    readonly psbt: Psbt;
    readonly data: PSBTDecodedData;
}

export class PSBTTransactionVerifier extends Logger {
    public readonly logColor: string = '#e0e0e0';

    private verificator: PSBTVerificator<PSBTTypes>[] = [];

    constructor(
        protected readonly db: ConfigurableDBManager,
        protected readonly network: Network = networks.bitcoin,
    ) {
        super();

        this.verificator.push(new UnwrapPSBTVerificator(this.db, network));
    }

    public async createRepositories(): Promise<void> {
        const promises = this.verificator.map((v) => v.createRepositories());

        await Promise.all(promises);
    }

    public async verify(data: Uint8Array): Promise<KnownPSBTObject | false> {
        const psbtType = data[0];
        const version = data[1];

        data = data.slice(2);

        const verificator = this.verificator.find((v) => v.type === psbtType);
        if (verificator) {
            const psbt = this.getPSBT(data);
            if (!psbt) {
                return false;
            }

            return await verificator.verify(psbt, version);
        }

        return false;
    }

    private getPSBT(data: Uint8Array): Psbt | undefined {
        try {
            return Psbt.fromBase64(Buffer.from(data).toString('base64'), { network: this.network });
        } catch (e) {
            this.warn(`Failed to decode PSBT: ${(e as Error).stack}`);
        }
    }
}
