import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Binary, Decimal128 } from 'mongodb';
import { IEpochSubmissionsDocument } from '../../src/src/db/documents/interfaces/IEpochSubmissionsDocument.js';
import { ChainIds } from '../../src/src/config/enums/ChainIds.js';
import { BitcoinNetwork } from '../../src/src/config/network/BitcoinNetwork.js';
import { EarlyMiningConfig } from '../../src/src/poc/configurations/types/IOPNetConsensus.js';

let mockEarlyMining: Record<string, Record<string, EarlyMiningConfig>> | undefined;

vi.mock('../../src/src/poc/configurations/OPNetConsensus.js', () => ({
    OPNetConsensus: {
        consensus: {
            EPOCH: {
                get EARLY_MINING() {
                    return mockEarlyMining;
                },
            },
        },
    },
}));

let mockChainId: number = ChainIds.Bitcoin;
let mockNetwork: string = BitcoinNetwork.regtest;

vi.mock('../../src/src/config/Config.js', () => ({
    Config: {
        BITCOIN: {
            get CHAIN_ID() {
                return mockChainId;
            },
            get NETWORK() {
                return mockNetwork;
            },
        },
    },
}));

import { Address } from '@btc-vision/transaction';
import { OPNetConsensus } from '../../src/src/poc/configurations/OPNetConsensus.js';
import { Config } from '../../src/src/config/Config.js';

function filterEarlyMiningSubmissions(
    submissions: IEpochSubmissionsDocument[],
    endBlock: bigint,
): IEpochSubmissionsDocument[] {
    const earlyMining = OPNetConsensus.consensus.EPOCH.EARLY_MINING;
    if (!earlyMining) {
        return submissions;
    }

    const chainConfig = earlyMining[Config.BITCOIN.CHAIN_ID as unknown as ChainIds];
    if (!chainConfig) {
        return submissions;
    }

    const networkConfig = chainConfig[Config.BITCOIN.NETWORK as unknown as BitcoinNetwork];
    if (!networkConfig || !networkConfig.ENABLED) {
        return submissions;
    }

    if (!networkConfig.WHITELISTED_PUBLIC_KEY) {
        return submissions;
    }

    if (networkConfig.EXPIRES_AT_BLOCK && endBlock >= networkConfig.EXPIRES_AT_BLOCK) {
        return submissions;
    }

    const whitelistedKey = networkConfig.WHITELISTED_PUBLIC_KEY;
    const eligible = submissions.filter((submission) => {
        const submissionKey = new Address(
            new Uint8Array(submission.epochProposed.mldsaPublicKey.buffer),
        );

        return whitelistedKey.equals(submissionKey);
    });

    return eligible;
}

const WHITELISTED_KEY_BYTES = new Uint8Array(32);
WHITELISTED_KEY_BYTES[0] = 0x04;
WHITELISTED_KEY_BYTES[1] = 0xda;
WHITELISTED_KEY_BYTES[2] = 0x73;
WHITELISTED_KEY_BYTES[31] = 0x6e;

const NON_WHITELISTED_KEY_BYTES = new Uint8Array(32);
NON_WHITELISTED_KEY_BYTES[0] = 0xaa;
NON_WHITELISTED_KEY_BYTES[1] = 0xbb;
NON_WHITELISTED_KEY_BYTES[31] = 0xff;

const NON_WHITELISTED_KEY_2 = new Uint8Array(32);
NON_WHITELISTED_KEY_2[0] = 0xcc;
NON_WHITELISTED_KEY_2[31] = 0xdd;

const WHITELISTED_ADDRESS = new Address(WHITELISTED_KEY_BYTES);

function makeSubmission(
    mldsaPublicKey: Uint8Array,
    overrides: Partial<{
        epochNumber: bigint;
        salt: Uint8Array;
        solution: Uint8Array;
        legacyPublicKey: Uint8Array;
        graffiti: Uint8Array;
        txId: Uint8Array;
        txHash: Uint8Array;
    }> = {},
): IEpochSubmissionsDocument {
    const salt = overrides.salt ?? new Uint8Array(32).fill(1);
    const solution = overrides.solution ?? new Uint8Array(20).fill(2);
    const legacyPk = overrides.legacyPublicKey ?? new Uint8Array(33).fill(3);
    const epochNum = overrides.epochNumber ?? 5n;
    const txId = overrides.txId ?? new Uint8Array(32).fill(4);
    const txHash = overrides.txHash ?? new Uint8Array(32).fill(5);

    return {
        confirmedAt: Decimal128.fromString(epochNum.toString()),
        epochNumber: Decimal128.fromString(epochNum.toString()),
        startBlock: Decimal128.fromString((epochNum * 5n).toString()),
        submissionTxId: new Binary(txId),
        submissionTxHash: new Binary(txHash),
        submissionHash: new Binary(solution),
        epochProposed: {
            solution: new Binary(solution),
            mldsaPublicKey: new Binary(mldsaPublicKey),
            legacyPublicKey: new Binary(legacyPk),
            salt: new Binary(salt),
            graffiti: overrides.graffiti ? new Binary(overrides.graffiti) : undefined,
        },
    };
}

function makeMainnetConfig(overrides: Partial<EarlyMiningConfig> = {}): EarlyMiningConfig {
    return {
        ENABLED: true,
        WHITELISTED_PUBLIC_KEY: WHITELISTED_ADDRESS,
        EXPIRES_AT_BLOCK: 948_200n,
        ...overrides,
    };
}

describe('filterEarlyMiningSubmissions', () => {
    beforeEach(() => {
        mockEarlyMining = undefined;
        mockChainId = ChainIds.Bitcoin;
        mockNetwork = BitcoinNetwork.mainnet;
    });

    describe('when early mining is not configured', () => {
        it('should return all submissions when EARLY_MINING is undefined', () => {
            mockEarlyMining = undefined;
            const submissions = [
                makeSubmission(NON_WHITELISTED_KEY_BYTES),
                makeSubmission(NON_WHITELISTED_KEY_2),
            ];

            const result = filterEarlyMiningSubmissions(submissions, 941_400n);
            expect(result).toHaveLength(2);
            expect(result).toBe(submissions);
        });

        it('should return all submissions when chain config is missing', () => {
            mockEarlyMining = {};
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 941_400n);
            expect(result).toHaveLength(1);
        });

        it('should return all submissions when network config is missing', () => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {},
            };
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 941_400n);
            expect(result).toHaveLength(1);
        });

        it('should return all submissions when ENABLED is false', () => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: { ENABLED: false },
                },
            };
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 941_400n);
            expect(result).toHaveLength(1);
        });

        it('should return all submissions when no WHITELISTED_PUBLIC_KEY is set', () => {
            mockNetwork = BitcoinNetwork.regtest;
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.regtest]: { ENABLED: true },
                },
            };
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 100n);
            expect(result).toHaveLength(1);
        });
    });

    describe('when whitelist has expired', () => {
        it('should return all submissions when endBlock equals EXPIRES_AT_BLOCK', () => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig(),
                },
            };
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 948_200n);
            expect(result).toHaveLength(1);
        });

        it('should return all submissions when endBlock exceeds EXPIRES_AT_BLOCK', () => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig(),
                },
            };
            const submissions = [
                makeSubmission(NON_WHITELISTED_KEY_BYTES),
                makeSubmission(NON_WHITELISTED_KEY_2),
            ];

            const result = filterEarlyMiningSubmissions(submissions, 999_999n);
            expect(result).toHaveLength(2);
        });
    });

    describe('when whitelist is active', () => {
        beforeEach(() => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig(),
                },
            };
        });

        it('should keep only whitelisted submissions', () => {
            const submissions = [
                makeSubmission(WHITELISTED_KEY_BYTES, { salt: new Uint8Array(32).fill(10) }),
                makeSubmission(NON_WHITELISTED_KEY_BYTES, { salt: new Uint8Array(32).fill(20) }),
                makeSubmission(NON_WHITELISTED_KEY_2, { salt: new Uint8Array(32).fill(30) }),
            ];

            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(1);

            const winnerKey = new Uint8Array(result[0].epochProposed.mldsaPublicKey.buffer);
            expect(winnerKey).toEqual(WHITELISTED_KEY_BYTES);
        });

        it('should return empty array when no submissions are whitelisted', () => {
            const submissions = [
                makeSubmission(NON_WHITELISTED_KEY_BYTES),
                makeSubmission(NON_WHITELISTED_KEY_2),
            ];

            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(0);
        });

        it('should return all submissions when all are whitelisted', () => {
            const submissions = [
                makeSubmission(WHITELISTED_KEY_BYTES, { salt: new Uint8Array(32).fill(10) }),
                makeSubmission(WHITELISTED_KEY_BYTES, { salt: new Uint8Array(32).fill(20) }),
            ];

            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(2);
        });

        it('should handle a single whitelisted submission among many', () => {
            const submissions: IEpochSubmissionsDocument[] = [];
            for (let i = 0; i < 10; i++) {
                const key = new Uint8Array(32);
                key[0] = i + 0x10;
                submissions.push(makeSubmission(key, { salt: new Uint8Array(32).fill(i) }));
            }
            submissions.push(
                makeSubmission(WHITELISTED_KEY_BYTES, { salt: new Uint8Array(32).fill(0xff) }),
            );

            const result = filterEarlyMiningSubmissions(submissions, 945_000n);
            expect(result).toHaveLength(1);

            const winnerKey = new Uint8Array(result[0].epochProposed.mldsaPublicKey.buffer);
            expect(winnerKey).toEqual(WHITELISTED_KEY_BYTES);
        });

        it('should handle empty submissions array', () => {
            const result = filterEarlyMiningSubmissions([], 941_500n);
            expect(result).toHaveLength(0);
        });
    });

    describe('block boundary edge cases', () => {
        beforeEach(() => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig(),
                },
            };
        });

        it('should filter at one block before expiry', () => {
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];
            const result = filterEarlyMiningSubmissions(submissions, 948_199n);
            expect(result).toHaveLength(0);
        });

        it('should NOT filter at exactly the expiry block', () => {
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];
            const result = filterEarlyMiningSubmissions(submissions, 948_200n);
            expect(result).toHaveLength(1);
        });

        it('should filter at block 0 when whitelist is active', () => {
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];
            const result = filterEarlyMiningSubmissions(submissions, 0n);
            expect(result).toHaveLength(0);
        });
    });

    describe('Address comparison', () => {
        beforeEach(() => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig(),
                },
            };
        });

        it('should match when submission key bytes exactly equal whitelisted key', () => {
            const exactMatch = new Uint8Array(WHITELISTED_KEY_BYTES);
            const submissions = [makeSubmission(exactMatch)];

            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(1);
        });

        it('should NOT match when a single byte differs', () => {
            const almostMatch = new Uint8Array(WHITELISTED_KEY_BYTES);
            almostMatch[15] = WHITELISTED_KEY_BYTES[15] ^ 0x01;

            const submissions = [makeSubmission(almostMatch)];
            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(0);
        });

        it('should NOT match an all-zeros key', () => {
            const zeroKey = new Uint8Array(32);
            const submissions = [makeSubmission(zeroKey)];

            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(0);
        });

        it('should NOT match an all-0xFF key', () => {
            const ffKey = new Uint8Array(32).fill(0xff);
            const submissions = [makeSubmission(ffKey)];

            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(0);
        });
    });

    describe('network isolation', () => {
        it('should not apply mainnet whitelist to testnet submissions', () => {
            mockNetwork = BitcoinNetwork.testnet;
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig(),
                    [BitcoinNetwork.testnet]: { ENABLED: false },
                },
            };
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(1);
        });

        it('should not apply mainnet whitelist to regtest submissions', () => {
            mockNetwork = BitcoinNetwork.regtest;
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig(),
                    [BitcoinNetwork.regtest]: { ENABLED: true },
                },
            };
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 100n);
            expect(result).toHaveLength(1);
        });
    });

    describe('permanent whitelist (no EXPIRES_AT_BLOCK)', () => {
        it('should filter indefinitely when EXPIRES_AT_BLOCK is not set', () => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig({
                        EXPIRES_AT_BLOCK: undefined,
                    }),
                },
            };
            const submissions = [makeSubmission(NON_WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 99_999_999n);
            expect(result).toHaveLength(0);
        });

        it('should still allow whitelisted miner with permanent whitelist', () => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig({
                        EXPIRES_AT_BLOCK: undefined,
                    }),
                },
            };
            const submissions = [makeSubmission(WHITELISTED_KEY_BYTES)];

            const result = filterEarlyMiningSubmissions(submissions, 99_999_999n);
            expect(result).toHaveLength(1);
        });
    });

    describe('genesis proposer fallback', () => {
        it('should return empty when all submissions are non-whitelisted', () => {
            mockEarlyMining = {
                [ChainIds.Bitcoin]: {
                    [BitcoinNetwork.mainnet]: makeMainnetConfig(),
                },
            };

            const submissions = [
                makeSubmission(NON_WHITELISTED_KEY_BYTES),
                makeSubmission(NON_WHITELISTED_KEY_2),
            ];

            const result = filterEarlyMiningSubmissions(submissions, 941_500n);
            expect(result).toHaveLength(0);
        });
    });
});
