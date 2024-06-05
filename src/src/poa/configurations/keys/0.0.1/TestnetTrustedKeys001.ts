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
                    opnet: 'I5OERYp1DnFWqDvAG6qJtJV9ULCGy9nrJMMbkH+NZTw=',
                    publicKey: 'A2dUn+gKx6b7DySYl1PjO715I0YnAd+fyViSa7TDFLbR',
                    signature:
                        'fpxsBHQsGE5Ooo04BOmyaK9KS2oNE5VygtuDN6Qypirzyr5JD5wmm6vc5N8SiAjSMXsVDzoThYQbJe+w5DHSCQ==',
                },
            ],
        },
    },
};
