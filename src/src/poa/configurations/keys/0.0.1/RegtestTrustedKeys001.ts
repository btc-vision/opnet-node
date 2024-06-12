import { NetworkAuthorityConfiguration } from '../../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../TrustedCompanies.js';

export const RegTestTrustedKeys001: NetworkAuthorityConfiguration = {
    /** Minimum different trusted validators */
    minimum: 2,

    /** Minimum different trusted validator in a new generated transaction */
    transactionMinimum: 2,

    /** Minimum different entities in a transaction */
    minimumValidatorTransactionGeneration: 2,

    /** Maximum trusted validator per entity in a transaction */
    maximumValidatorPerTrustedEntities: 3,

    /** Trusted entities */
    trusted: {
        [TrustedCompanies.OPNet]: {
            keys: [
                {
                    opnet: 'GNwrQoTHZv7fxM4P3nsSdrHDtnLYdP0n7YJqWBc4NVI=',
                    publicKey: 'AgPmjuI2/MNJM9STswWm8MdWEllHHRPs0Q3+DjdjOny+',
                    signature:
                        '2z0mncHxbBwps/81dVPKQcManzjcJ+r+4dmkD+MxZJ3ZdbEoeDlRhy6xa362JVRiBZtdyeQV7q6mckpohvUNCw==',
                    wallet: 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlh3',
                },
                {
                    opnet: '5BtduXr1lGbuiHf3qz9EFE11niebe5tDmvXkyMnj7S4=',
                    publicKey: 'AtOOpbDsniLbs2QGuqPFu7AnCOK9lNSSl+pvPr0m0Yx3',
                    signature:
                        'JRIpK00+4EZIto8ZvFWOWQLIyIjr6MjqEPqyHCOcDUdQtOTL0d/pOxZYQ/GZN2hE1POk6SE7TDWPufSOqWt/AA==',
                    wallet: 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlh2',
                },
            ],
        },
        [TrustedCompanies.SatoshiNakamoto]: {
            keys: [
                {
                    opnet: 'mnJZPF0NlBXQsdZKioaJjbtJxLiWh5HWZ84oNQIu4V8=',
                    publicKey: 'A4JEwTBwTx5QaLCFORTow27UQvkLQWZguhz6N+d8FczI',
                    signature:
                        'VyIjWk39b99diOcRElMXOCg3Tmhv8Ifib7dG9HWQ4KyXl4rii4+fdvdJE2p9hhonn4qwj5v9gF4MLzJFXnsHDA==',
                    wallet: 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlh4',
                },
                {
                    opnet: '+Fgsaw2m4TTibrq5AuXiXRZu1xnTN0bXHB5SGCFFHrM=',
                    publicKey: 'A7ZKMoDQJlcQNbzIikCE5MPiFC81RvHHTeTMRx2/bFiO',
                    signature:
                        'HXYQeSm2lR2RXbdJbAreKQFSHghNG2D/AsOubOJjpwDrdTnRxew1WJ5YOEqYq54VH6cpBF9sVlbId/0sb9r/DQ==',
                    wallet: 'bcrt1pgtvs9zkjj97kqqm4pkkv09v26cpar9axn6uxf6x79hxkr5jm98rsn7hgyu',
                },
            ],
        },
    },
};
