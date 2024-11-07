import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

export const MainnetTrustedKeys001: NetworkAuthorityConfiguration = {
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
    },
};
