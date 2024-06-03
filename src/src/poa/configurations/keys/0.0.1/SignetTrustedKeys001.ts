import { NetworkAuthorityConfiguration } from '../../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../TrustedCompanies.js';

export const SignetTrustedKeys001: NetworkAuthorityConfiguration = {
    minimum: 1,
    transactionMinimum: 1,
    maximumValidatorPerTrustedEntities: 1,

    trusted: {
        [TrustedCompanies.OPNet]: {
            keys: [],
        },
    },
};
