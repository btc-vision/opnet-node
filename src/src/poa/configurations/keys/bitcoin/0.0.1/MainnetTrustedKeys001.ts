import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../../TrustedCompanies.js';

export const MainnetTrustedKeys001: NetworkAuthorityConfiguration = {
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
                    opnet: 'I5OERYp1DnFWqDvAG6qJtJV9ULCGy9nrJMMbkH+NZTw=',
                    publicKey: 'A2dUn+gKx6b7DySYl1PjO715I0YnAd+fyViSa7TDFLbR',
                    signature:
                        'fpxsBHQsGE5Ooo04BOmyaK9KS2oNE5VygtuDN6Qypirzyr5JD5wmm6vc5N8SiAjSMXsVDzoThYQbJe+w5DHSCQ==',
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
                },
            ],
        },
        /** Fictional company */
        [TrustedCompanies.MotoSwap]: {
            keys: [
                {
                    opnet: 'GNwrQoTHZv7fxM4P3nsSdrHDtnLYdP0n7YJqWBc4NVI=',
                    publicKey: 'AgPmjuI2/MNJM9STswWm8MdWEllHHRPs0Q3+DjdjOny+',
                    signature:
                        '2z0mncHxbBwps/81dVPKQcManzjcJ+r+4dmkD+MxZJ3ZdbEoeDlRhy6xa362JVRiBZtdyeQV7q6mckpohvUNCw==',
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
                },
                {
                    opnet: '5BtduXr1lGbuiHf3qz9EFE11niebe5tDmvXkyMnj7S4=',
                    publicKey: 'AtOOpbDsniLbs2QGuqPFu7AnCOK9lNSSl+pvPr0m0Yx3',
                    signature:
                        'JRIpK00+4EZIto8ZvFWOWQLIyIjr6MjqEPqyHCOcDUdQtOTL0d/pOxZYQ/GZN2hE1POk6SE7TDWPufSOqWt/AA==',
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
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
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
                },
            ],
        },
        /** --------- Fictional company --------- */
    },
};
