import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

export const DogecoinTestnetTrustedKeys: NetworkAuthorityConfiguration = {
    /** Minimum different trusted validators */
    minimum: 2,

    /** Minimum different trusted validator in a new generated transaction */
    transactionMinimum: 2,

    /** Minimum different entities in a transaction */
    minimumValidatorTransactionGeneration: 1,

    /** Maximum trusted validator per entity in a transaction */
    maximumValidatorPerTrustedEntities: 3,

    trusted: {
        [TrustedEntities.OPNet]: {
            keys: [
                {
                    opnet: 'ebWtJ4qxy0HKEgE72BRFQZhCIaO/6zVjrBwd64K1UMA=',
                    publicKey: 'Awl4XAeELLnpyUvXXWnW5hWLZsGJBRuA36+YFMYk6dSA',
                    signature:
                        '1yclNUxjodcDkY9L+Kg7rq/VW7f3kfFnz+ftuBsekDGW0kXdLNGN7qYO8Hc482gcwQHVB4nz0G7XM/xyYnTMDg==',
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
                },

                {
                    opnet: '/G29rhUysSbvxfcHL1icK8+Qs4whsj2gwaIy6Lo+jS0=',
                    publicKey: 'A1TTZcFlM+wb8bF+Jtb8ZSH8cEkeT3UtEqn/Gx6Ib6rV',
                    signature:
                        'A9sxaq5+Fe5dcpACydgImZgMNCRHVcAFj7GVPgBOmxD0Xsdl5FftR4L4Q6MtuVByXswXpmgQI4Lo6bTdQQNfBQ==',
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
                },

                {
                    opnet: 'yik6iMXTL4R7866sRlJ7Vw+02Yc+cfUBHr1tCpHaQoY=',
                    publicKey: 'A1ByXH6baQmW/K6rKuHGZCvwKodE0kSwy9RECNRG0ysv',
                    signature:
                        'ynfrWXR0xLatX7zXJxWtt78oa6qgVfdvqehAVHKV0fuqdNJ7esBMNC+v3GLiBdWdoU4d5bHXCVAS/EAVL4B8AA==',
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
                },
            ],
        },
    },
};
