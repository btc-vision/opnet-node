import { NetworkAuthorityConfiguration } from '../../../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../../../TrustedEntities.js';

export const RegTestTrustedKeys001: NetworkAuthorityConfiguration = {
    /** Minimum different trusted validators */
    minimum: 1,

    /** Minimum different trusted validator in a new generated transaction */
    transactionMinimum: 2,

    /** Minimum different entities in a transaction */
    minimumValidatorTransactionGeneration: 2,

    /** Maximum trusted validator per entity in a transaction */
    maximumValidatorPerTrustedEntities: 3,

    /** Trusted entities */
    trusted: {
        [TrustedEntities.OPNet]: {
            keys: [
                {
                    opnet: 'zhguwoSu8PafwS8kntmr8YKyIlTp/zNkTKgQfryS1kM=',
                    publicKey: 'A05yGPopoMeVUB1wBZcByPZaBuL/f6b+ooe6zLu6A+55',
                    signature:
                        'O96Qyk6PFmmUXuOS1N5U3EF0VC62gHQ/FwTbbHZaZ0ORFIFGe0pGrwVPB42AnsBRYbT495qFOsAG8jqCXrajDw==',
                    walletPubKey:
                        '0x034e7218fa29a0c795501d70059701c8f65a06e2ff7fa6fea287baccbbba03ee79',
                },
                {
                    opnet: '8NV8OYBOMrTCemX8673aRSCEqSu0ulr61FmDqAbEDE8=',
                    publicKey: 'AyHXwluCY1y1MC17j7jPJID3NDXqA6Z3jd/dbxv2VNNp',
                    signature:
                        'RgJ/elBNAFWEJPTarFxGNrCQte1aVNLRpnirTiCO7/qJKhP2RT2mZ3YFtj36hYglgmuyfD9CUj05SUsMFYmtBA==',
                    walletPubKey:
                        '0x0321d7c25b82635cb5302d7b8fb8cf2480f73435ea03a6778ddfdd6f1bf654d369',
                },
                {
                    opnet: 'sEjKV3wc5p37yB8OppVLQ1Hgf8N51g2kwT6Oe1gnu3c=',
                    publicKey: 'A8eS5brs2ES2e8DfDI3uDQNFz0eA23I/rXpida57MPYm',
                    signature:
                        'Qx7x5o2c3umr39yO381Svg+3NclZmA1MZzaKLLcmqmSv2DzjPibek6otfzna+RU/dIY0F8v7fjbOv8uJcWC/Bg==',
                    walletPubKey:
                        '0x03c792e5baecd844b67bc0df0c8dee0d0345cf4780db723fad7a6275ae7b30f626',
                },
                {
                    opnet: 'rvp8hahw3SU4SoX9yjBVCw9r2pb8bAPU7iH/ngegYw0=',
                    publicKey: 'Agu63urPfnJyQHXxLtc1ctaazDAmbGVc4yeG974yFFS6',
                    signature:
                        'PrqgAOeMteX+8DDlnnBg/MNRn69T3Td7wbxxbyTAs0TOprrEoMlGECBWJKqykJ/yym6XupbIa6Ucij6HJxPRBw==',
                    walletPubKey:
                        '0x020bbadeeacf7e72724075f12ed73572d69acc30266c655ce32786f7be321454ba',
                },
            ],
        },
    },
};
