import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

export const RegTestTrustedKeys001: NetworkAuthorityConfiguration = {
    /** Minimum different trusted validators */
    minimum: 1,

    /** Minimum different trusted validator in a new generated transaction */
    transactionMinimum: 1,

    /** Minimum different entities in a transaction */
    minimumValidatorTransactionGeneration: 1,

    /** Maximum trusted validator per entity in a transaction */
    maximumValidatorPerTrustedEntities: 1,

    /** Trusted entities */
    trusted: {
        [TrustedEntities.OPNet]: {
            keys: [
                {
                    opnet: 'bV6cUEZ59pCaJatFWsyFnwGW9lC2Ywc9iUIfOJQc3Xg=',
                    publicKey: 'A2sbw/zMrNq1SDE5LY8n5wq69G4ieDRyzSL8VZiJ1R8/',
                    signature:
                        '44Jrlflm/rY/j5lrq4f7uT9y69mEw4Q8Olfy0TQJDkqmm+doEDXd7QBPBmYXJJKMQ70QNp04dLnYw0zidM+nDA==',
                    walletPubKey:
                        '0x036b1bc3fcccacdab54831392d8f27e70abaf46e22783472cd22fc559889d51f3f',
                },
            ],
        },
    },
};
