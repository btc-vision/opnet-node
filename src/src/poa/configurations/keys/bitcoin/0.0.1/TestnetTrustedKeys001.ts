import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

export const TestNetTrustedKeys001: NetworkAuthorityConfiguration = {
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
                    opnet: 'qrb3r8RleCkkZNQzpuAsGwB8PC7ud31IUTqHLEDchIU=',
                    publicKey: 'Ar1UTQuIiFH8mOIJaW7v0WEw5GAZZDj4sCyK/xcftqMk',
                    signature:
                        'S/7j/IpbkIFAJTob+mNp02bZvOJ2b8zAgClWU2n8Zk88/TFSUAqL4taACPPlis3tHVyt7rmpT88AywCIXaVCAA==',
                    walletPubKey:
                        '0x02bd544d0b888851fc98e209696eefd16130e460196438f8b02c8aff171fb6a324',
                },
                {
                    opnet: 'zo5sKJKbbPS0wZEph0FLynbMG0RhortH7cDmMvS5HZ0=',
                    publicKey: 'A/ijEi+9VqSQqj0n9OabsGYSqVX7+zw8cyV+2ENEUOOY',
                    signature:
                        '3u3d7S74NgT0hf1gs9X6M5woS/GtDUlsGodRmOM+do4EN3+aTdutzlkYuyhTvw/VC0ZI9o+jFMlvPe2VejObAg==',
                    walletPubKey:
                        '0x03f8a3122fbd56a490aa3d27f4e69bb06612a955fbfb3c3c73257ed8434450e398',
                },
            ],
        },
    },
};
