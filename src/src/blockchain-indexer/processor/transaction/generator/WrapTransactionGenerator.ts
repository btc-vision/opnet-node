import { Logger } from '@btc-vision/bsi-common';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import {
    TrustedAuthority,
    TrustedPublicKeysWithConstraints,
} from '../../../../poa/configurations/manager/TrustedAuthority.js';

export interface WrapTransactionParameters {
    readonly amount: bigint;
}

export class WrapTransactionGenerator extends Logger {
    public readonly logColor: string = '#5dbcef';

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();
    private readonly wbtcContractAddress: string = this.currentAuthority.WBTC_CONTRACT_ADDRESS;

    constructor() {
        super();
    }

    public async generateWrapTransaction(
        params: WrapTransactionParameters,
    ): Promise<string | undefined> {
        this.log(`Generating wrap transaction... (WBTC: ${this.wbtcContractAddress})`);

        const trustedValidators: TrustedPublicKeysWithConstraints =
            this.currentAuthority.trustedPublicKeysRespectingConstraints;

        console.log('Selected validators: ', trustedValidators);

        return '';
    }
}
