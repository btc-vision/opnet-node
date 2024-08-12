import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../../TrustedCompanies.js';

export const MainnetTrustedKeys001Fractal: NetworkAuthorityConfiguration = {
    /** Minimum different trusted validators */
    minimum: 2,

    /** Minimum different trusted validator in a new generated transaction */
    transactionMinimum: 2,

    /** Minimum different entities in a transaction */
    minimumValidatorTransactionGeneration: 1,

    /** Maximum trusted validator per entity in a transaction */
    maximumValidatorPerTrustedEntities: 3,

    trusted: {
        [TrustedCompanies.OPNet]: {
            keys: [
                {
                    opnet: 'sipzeI6gxmed7flaZe8/S0ud1AbolTRTgXPJqdLDsXQ=',
                    publicKey: 'AwsdUc6BvUNz0ntDvhjRWwrIDDyxQET0Y6KUldqVOl0l',
                    signature:
                        'Toi04FwpfrZG7ChYBvnqOBy/Gf28OJ8s8VTnJaKa54iMlQvhbZAxLv83a5crVRQ7oOQFTATlzZsA/FXbFBM5Aw==',
                    wallet: 'bc1pf73kac2d5udqfej04juxngnd4r586jctndrslk8mxy42gfqzmdfsea8hng',
                },

                {
                    opnet: 'YvSV9TBdT4xG0tkiMYIsAUkMcfhJTxhpffbB3a2PSn4=',
                    publicKey: 'A1IEmPGIa9InIL6VWJSyyhrGQ5rH43NYJG6jo/iOOmlT',
                    signature:
                        '1SyAB+wqnwAwP3VxmzO3dz2oXg4RGslNZKO58fUXFvWbRxfZfbOTl7/4KyVHfRriittk9b197u7vQ+yb0/HDBw==',
                    wallet: 'bc1pp7dqx4mz3tmnp5hqnu4h873qpa9n3lqg0a8lk9azelrqf2kckmzqtgegw7',
                },
            ],
        },
    },
};
