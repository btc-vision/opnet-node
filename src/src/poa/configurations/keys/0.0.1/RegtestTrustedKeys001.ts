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
                /*{
                    opnet: '5BtduXr1lGbuiHf3qz9EFE11niebe5tDmvXkyMnj7S4=',
                    publicKey: 'a',
                    signature: 'a',
                },
                {
                    opnet: 'mnJZPF0NlBXQsdZKioaJjbtJxLiWh5HWZ84oNQIu4V8=',
                    publicKey: 'a',
                    signature: 'a',
                },*/
            ],
        },
    },
};
