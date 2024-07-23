import { NetworkAuthorityConfiguration } from '../../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../TrustedCompanies.js';

export const TestNetTrustedKeys001: NetworkAuthorityConfiguration = {
    /** Minimum different trusted validators */
    minimum: 2,

    /** Minimum different trusted validator in a new generated transaction */
    transactionMinimum: 3,

    /** Minimum different entities in a transaction */
    minimumValidatorTransactionGeneration: 2,

    /** Maximum trusted validator per entity in a transaction */
    maximumValidatorPerTrustedEntities: 3,

    trusted: {
        [TrustedCompanies.OPNet]: {
            keys: [
                {
                    opnet: 'ebWtJ4qxy0HKEgE72BRFQZhCIaO/6zVjrBwd64K1UMA=',
                    publicKey: 'Awl4XAeELLnpyUvXXWnW5hWLZsGJBRuA36+YFMYk6dSA',
                    signature:
                        '1yclNUxjodcDkY9L+Kg7rq/VW7f3kfFnz+ftuBsekDGW0kXdLNGN7qYO8Hc482gcwQHVB4nz0G7XM/xyYnTMDg==',
                    wallet: 'tb1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gszlcez5',
                },

                /*{
                    opnet: 'ebWtJ4qxy0HKEgE72BRFQZhCIaO/6zVjrBwd64K1UMA=',
                    publicKey: 'Awl4XAeELLnpyUvXXWnW5hWLZsGJBRuA36+YFMYk6dSA',
                    signature:
                        '1yclNUxjodcDkY9L+Kg7rq/VW7f3kfFnz+ftuBsekDGW0kXdLNGN7qYO8Hc482gcwQHVB4nz0G7XM/xyYnTMDg==',
                    wallet: 'tb1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gszlcez5',
                },*/
            ],
        },
    },
};
