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
            ],
        },
    },
};
