import { NetworkAuthorityConfiguration } from '../../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../TrustedCompanies.js';

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
                    opnet: 'GNwrQoTHZv7fxM4P3nsSdrHDtnLYdP0n7YJqWBc4NVI=',
                    publicKey: 'AgPmjuI2/MNJM9STswWm8MdWEllHHRPs0Q3+DjdjOny+',
                    signature:
                        '2z0mncHxbBwps/81dVPKQcManzjcJ+r+4dmkD+MxZJ3ZdbEoeDlRhy6xa362JVRiBZtdyeQV7q6mckpohvUNCw==',
                },
            ],
        },
    },
};
