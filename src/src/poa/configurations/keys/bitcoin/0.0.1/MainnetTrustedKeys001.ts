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
                    opnet: 'Ij2/yNdetF582GddzSkDDueON/Gi9pIj2wcuXoMUt7c=',
                    publicKey: 'A3ILPQLqsszby9ktoDTqKyQnFfyk3tSvSU5F8yxO4LeR',
                    signature:
                        'D00IOIJl/xayGSD8WbZVTY9PTxVnPANlj7qgexXBsmIyzQTZdHH8NXj+YmKrfb51BJ8eE5rwhI+EagK0jHsnBQ==',
                    walletPubKey:
                        '0x03720b3d02eab2ccdbcbd92da034ea2b242715fca4ded4af494e45f32c4ee0b791',
                },
            ],
        },
    },
};
