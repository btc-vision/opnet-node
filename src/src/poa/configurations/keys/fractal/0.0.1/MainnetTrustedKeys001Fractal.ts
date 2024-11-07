import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

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
        [TrustedEntities.OPNet]: {
            keys: [
                {
                    opnet: 'sipzeI6gxmed7flaZe8/S0ud1AbolTRTgXPJqdLDsXQ=',
                    publicKey: 'AwsdUc6BvUNz0ntDvhjRWwrIDDyxQET0Y6KUldqVOl0l',
                    signature:
                        'Toi04FwpfrZG7ChYBvnqOBy/Gf28OJ8s8VTnJaKa54iMlQvhbZAxLv83a5crVRQ7oOQFTATlzZsA/FXbFBM5Aw==',
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
                },

                {
                    opnet: 'YvSV9TBdT4xG0tkiMYIsAUkMcfhJTxhpffbB3a2PSn4=',
                    publicKey: 'A1IEmPGIa9InIL6VWJSyyhrGQ5rH43NYJG6jo/iOOmlT',
                    signature:
                        '1SyAB+wqnwAwP3VxmzO3dz2oXg4RGslNZKO58fUXFvWbRxfZfbOTl7/4KyVHfRriittk9b197u7vQ+yb0/HDBw==',
                    walletPubKey:
                        '0x027fdcb918fa0f4a7693f3df5ed6f2510ea91f33f16e081d208cf3dd93f466c8ab',
                },
            ],
        },
    },
};
