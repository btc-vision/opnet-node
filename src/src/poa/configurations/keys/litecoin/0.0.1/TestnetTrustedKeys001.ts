import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

export const LitecoinTestnetTrustedKeys: NetworkAuthorityConfiguration = {
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
                    opnet: 'do6HCM3EoGpPSC++D9i0quUiTaEkt9icgI9Pja60KtE=',
                    publicKey: 'AgIWCrJBWmkAe0L2MsQV34sNb/4pC7Jj/RabWQc05pv0',
                    signature:
                        'BPde2pIgm5U+UJN1NSLOWYjn8rxx879daG+7pM4W3fS9Gv88E+znFmtl74xY9MfORKamq8W01kFR8TeMqNZxBQ==',
                    walletPubKey:
                        '0x0202160ab2415a69007b42f632c415df8b0d6ffe290bb263fd169b590734e69bf4',
                },
            ],
        },
    },
};
