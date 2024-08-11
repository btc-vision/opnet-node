import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../../TrustedCompanies.js';

export const MainnetTrustedKeys001Fractal: NetworkAuthorityConfiguration = {
    /** Minimum different trusted validators */
    minimum: 2,

    /** Minimum different trusted validator in a new generated transaction */
    transactionMinimum: 2,

    /** Minimum different entities in a transaction */
    minimumValidatorTransactionGeneration: 1,

    /** Maximum trusted validator per entity in a transaction */
    maximumValidatorPerTrustedEntities: 3,

    trusted: {
        [TrustedCompanies.OPNet]: {
            keys: [
                {
                    opnet: 'sipzeI6gxmed7flaZe8/S0ud1AbolTRTgXPJqdLDsXQ=',
                    publicKey: 'AwsdUc6BvUNz0ntDvhjRWwrIDDyxQET0Y6KUldqVOl0l',
                    signature:
                        'Toi04FwpfrZG7ChYBvnqOBy/Gf28OJ8s8VTnJaKa54iMlQvhbZAxLv83a5crVRQ7oOQFTATlzZsA/FXbFBM5Aw==',
                    wallet: 'tb1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gszlcez5',
                },

                // fake temp

                {
                    opnet: '/G29rhUysSbvxfcHL1icK8+Qs4whsj2gwaIy6Lo+jS0=',
                    publicKey: 'A1TTZcFlM+wb8bF+Jtb8ZSH8cEkeT3UtEqn/Gx6Ib6rV',
                    signature:
                        'A9sxaq5+Fe5dcpACydgImZgMNCRHVcAFj7GVPgBOmxD0Xsdl5FftR4L4Q6MtuVByXswXpmgQI4Lo6bTdQQNfBQ==',
                    wallet: 'tb1pllsazp7qcjz52j2ns8rugwmc97eevs9xzsup3txm5rrvq7szd5nshyz92y',
                },

                {
                    opnet: 'yik6iMXTL4R7866sRlJ7Vw+02Yc+cfUBHr1tCpHaQoY=',
                    publicKey: 'A1ByXH6baQmW/K6rKuHGZCvwKodE0kSwy9RECNRG0ysv',
                    signature:
                        'ynfrWXR0xLatX7zXJxWtt78oa6qgVfdvqehAVHKV0fuqdNJ7esBMNC+v3GLiBdWdoU4d5bHXCVAS/EAVL4B8AA==',
                    wallet: 'tb1punpafxjk5uqgrm2meux30qz2azvg43t37edexpkhkwxwe44np4csephlhc',
                },
            ],
        },
    },
};
