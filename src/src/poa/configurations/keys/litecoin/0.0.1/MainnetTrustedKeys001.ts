import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

export const LitecoinMainnetTrustedKeys: NetworkAuthorityConfiguration = {
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
            keys: [],
        },
    },
};
