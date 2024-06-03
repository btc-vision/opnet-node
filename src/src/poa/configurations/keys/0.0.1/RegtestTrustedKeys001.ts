import { NetworkAuthorityConfiguration } from '../../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../TrustedCompanies.js';

export const RegTestTrustedKeys001: NetworkAuthorityConfiguration = {
    minimum: 2,
    transactionMinimum: 3,
    maximumValidatorPerTrustedEntities: 2,

    trusted: {
        [TrustedCompanies.OPNet]: {
            keys: [
                {
                    opnet: 'GNwrQoTHZv7fxM4P3nsSdrHDtnLYdP0n7YJqWBc4NVI=',
                    publicKey: 'A+aO4jb8w0kz1JOzBabwx1YSWUcdE+zRDf4ON2M6fL4=',
                    signature:
                        'wCBN461YcY+4WFoTAjEgfVX7N1RVka5nNRmtBrKdJJHSlZAtuhMDmebTjvlqTpK8AhHdyTTBzJBw63z3knrcDw==',
                },
                {
                    opnet: '5BtduXr1lGbuiHf3qz9EFE11niebe5tDmvXkyMnj7S4=',
                    publicKey: '046lsOyeItuzZAa6o8W7sCcI4r2U1JKX6m8+vSbRjHc=',
                    signature:
                        'UDpGNaD6TwRfzSl3g/Z5J6jXPGJONnBZZaqjptMnmerzQbww+GJIY72KhKa2xWCBmMjZg/+F2l7nkIqVgVUDBg==',
                },
                {
                    opnet: 'mnJZPF0NlBXQsdZKioaJjbtJxLiWh5HWZ84oNQIu4V8=',
                    publicKey: 'gkTBMHBPHlBosIU5FOjDbtRC+QtBZmC6HPo353wVzMg=',
                    signature:
                        'ksXFJ5/g9GfgA2DONBZYSlW/vIWPoOhKwgNUnDW+SvWvoYviuF1WAHdIuXWq2uyBZD4cOzG+CwREoUjaI1Y+Bw==',
                },
            ],
        },
    },
};
