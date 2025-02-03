import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

export const MainnetTrustedKeys001: NetworkAuthorityConfiguration = {
    /** Minimum different trusted validators */
    minimum: 1,

    /** Minimum different trusted validator in a new generated transaction */
    transactionMinimum: 1,

    /** Minimum different entities in a transaction */
    minimumValidatorTransactionGeneration: 1,

    /** Maximum trusted validator per entity in a transaction */
    maximumValidatorPerTrustedEntities: 1,

    trusted: {
        [TrustedEntities.OPNet]: {
            keys: [
                {
                    opnet: 'R8rFyD9W6iwxf51GpRYKBZnSLgkc6tqGJq9GPtVT83o',
                    publicKey: 'Ag6KUX5yvHdpL8xvQ5Uj9xOR1+XdwOU0jnJZkqJLUAA2',
                    signature:
                        '1B5GJ2aTIkWfvXZjVqrdYeBsbHlyPC6MM9bVDOKbX2Dd6+EFlDQb0uxDUzwkebqss96f4TsZhj5LCcYfovCzBg==',
                    walletPubKey:
                        '0x020e8a517e72bc77692fcc6f439523f71391d7e5ddc0e5348e725992a24b500036',
                },
            ],
        },
    },
};
