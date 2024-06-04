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
    maximumValidatorPerTrustedEntities: 1,

    /** Trusted entities */
    trusted: {
        [TrustedCompanies.OPNet]: {
            keys: [
                {
                    opnet: 'GNwrQoTHZv7fxM4P3nsSdrHDtnLYdP0n7YJqWBc4NVI=',
                    publicKey: 'AgPmjuI2/MNJM9STswWm8MdWEllHHRPs0Q3+DjdjOny+',
                    signature:
                        '2z0mncHxbBwps/81dVPKQcManzjcJ+r+4dmkD+MxZJ3ZdbEoeDlRhy6xa362JVRiBZtdyeQV7q6mckpohvUNCw==',
                },
                {
                    opnet: '5BtduXr1lGbuiHf3qz9EFE11niebe5tDmvXkyMnj7S4=',
                    publicKey: '046lsOyeItuzZAa6o8W7sCcI4r2U1JKX6m8+vSbRjHc=',
                    signature:
                        'UDpGNaD6TwRfzSl3g/Z5J6jXPGJONnBZZaqjptMnmerzQbww+GJIY72KhKa2xWCBmMjZg/+F2l7nkIqVgVUDBg==',
                },
            ],
        },
        [TrustedCompanies.OPNetTest]: {
            keys: [
                {
                    opnet: 'mnJZPF0NlBXQsdZKioaJjbtJxLiWh5HWZ84oNQIu4V8=',
                    publicKey: 'gkTBMHBPHlBosIU5FOjDbtRC+QtBZmC6HPo353wVzMg=',
                    signature:
                        'ksXFJ5/g9GfgA2DONBZYSlW/vIWPoOhKwgNUnDW+SvWvoYviuF1WAHdIuXWq2uyBZD4cOzG+CwREoUjaI1Y+Bw==',
                },
            ],
        },
    },
};
