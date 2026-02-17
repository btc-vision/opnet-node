import { describe, expect, test, beforeAll } from 'vitest';
import { TransactionInput } from '../../src/src/blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import { VIn } from '@btc-vision/bitcoin-rpc';
import { OPNetConsensus } from '../../src/src/poc/configurations/OPNetConsensus.js';
import { toHex } from '@btc-vision/bitcoin';

// Test data constants
const VALID_TXID = 'a'.repeat(64);
const COMPRESSED_PUBKEY = '0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b';
const UNCOMPRESSED_PUBKEY =
    '04' +
    '50863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352' +
    '2cd470243453a299fa9e77237716103abc11a1df38855ed6f2ee187e9c582ba6';
const DER_SIGNATURE =
    '3045022100c2e78f7c69a0702d7585aa0631c42bf78e33a001bee9a1c2b6138e3801aade1402206378f959e00124defa8428d5b0396ffb53fd8504f0acbacaf00d7c153c3bab5901';
const SCHNORR_SIGNATURE =
    'a1f50a59c4416ceb9f88814fd5927a899031c4d6073d577b75cd4f400fef92be87e84e5e5731e6d386f5ff87759fe165514548b7f9f9e68f2a4b8d88f8bf2c3c';
const PUBKEY_HASH_20_BYTES = '8335a32dcfa3ffb1636df8fa89e020f4c0460c66';

// Raw transaction hex from the reported bug (tx 8dac5e0f4dd7f576a3587194b73537041805391a158dfd80ceb0b997fd2fefa2)
const RAW_TX_HEX =
    '02000000000101167b7289f84cd45ea867c518a1f84c57857e4142e08a5a970b192dc0d3a212306b00000000ffffffff03780c030000000000225120a8027e4865dcbb15213e16769d3dfdfce09e68122b158f4b73893875f1cbeb9a6914000000000000225120a8027e4865dcbb15213e16769d3dfdfce09e68122b158f4b73893875f1cbeb9af8b40000000000001600148335a32dcfa3ffb1636df8fa89e020f4c0460c6602483045022100c2e78f7c69a0702d7585aa0631c42bf78e33a001bee9a1c2b6138e3801aade1402206378f959e00124defa8428d5b0396ffb53fd8504f0acbacaf00d7c153c3bab5901210205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b00000000';

describe('TransactionInput', () => {
    beforeAll(() => {
        // Initialize OPNetConsensus for tests that use toStripped()
        OPNetConsensus.setBlockHeight(1n);
    });

    // ==================== CONSTRUCTOR TESTS ====================
    describe('constructor', () => {
        test('should parse valid txid', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.originalTransactionId).toBeInstanceOf(Uint8Array);
            expect(toHex(input.originalTransactionId)).toBe(VALID_TXID);
            expect(input.originalTransactionId.length).toBe(32);
        });

        test('should handle empty txid string', () => {
            const vin: VIn = {
                txid: '',
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.originalTransactionId.length).toBe(0);
        });

        test('should handle undefined txid (coinbase)', () => {
            const vin: VIn = {
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            } as VIn;

            const input = new TransactionInput(vin);

            expect(input.originalTransactionId.length).toBe(0);
        });

        test('should parse vout correctly', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 42,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.outputTransactionIndex).toBe(42);
        });

        test('should handle vout of 0', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.outputTransactionIndex).toBe(0);
        });

        test('should parse scriptSig', () => {
            const scriptSig = {
                asm: 'OP_DUP OP_HASH160 abc123 OP_EQUALVERIFY OP_CHECKSIG',
                hex: 'deadbeef',
            };
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig,
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.scriptSignature).toEqual(scriptSig);
        });

        test('should parse sequence', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 0xfffffffe,
            };

            const input = new TransactionInput(vin);

            expect(input.sequenceId).toBe(0xfffffffe);
        });

        test('should convert witness hex strings to Buffers', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
            };

            const input = new TransactionInput(vin);

            expect(input.transactionInWitness).toHaveLength(2);
            expect(input.transactionInWitness[0]).toBeInstanceOf(Uint8Array);
            expect(input.transactionInWitness[1]).toBeInstanceOf(Uint8Array);
            expect(input.transactionInWitness[1].length).toBe(33); // byte length, not hex length
        });

        test('should handle empty witness array', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [],
            };

            const input = new TransactionInput(vin);

            expect(input.transactionInWitness).toHaveLength(0);
        });

        test('should handle undefined witness', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.transactionInWitness).toHaveLength(0);
        });

        test('should parse coinbase data', () => {
            const coinbaseHex = '03a5b2060004deadbeef';
            const vin: VIn = {
                txid: '',
                vout: 4294967295,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                coinbase: coinbaseHex,
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            expect(stripped.coinbase).toBeInstanceOf(Uint8Array);
            expect(toHex(stripped.coinbase!)).toBe(coinbaseHex);
        });

        test('should handle missing coinbase', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            expect(stripped.coinbase).toBeUndefined();
        });
    });

    // ==================== DECODE PUBKEY TESTS ====================
    describe('decodePubKey', () => {
        describe('P2WPKH (Native SegWit)', () => {
            test('should decode compressed public key (33 bytes) from witness', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).not.toBeNull();
                expect(toHex(input.decodedPubKey!)).toBe(COMPRESSED_PUBKEY);
                expect(input.decodedPubKey!.length).toBe(33);
            });

            test('should decode uncompressed public key (65 bytes) from witness', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, UNCOMPRESSED_PUBKEY],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).not.toBeNull();
                expect(toHex(input.decodedPubKey!)).toBe(UNCOMPRESSED_PUBKEY);
                expect(input.decodedPubKey!.length).toBe(65);
            });

            test('should decode pubkey starting with 02 (even y-coordinate)', () => {
                const evenPubkey =
                    '02' + '50863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352';
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, evenPubkey],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).not.toBeNull();
                expect(input.decodedPubKey![0]).toBe(0x02);
            });

            test('should decode pubkey starting with 03 (odd y-coordinate)', () => {
                const oddPubkey =
                    '03' + '50863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352';
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, oddPubkey],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).not.toBeNull();
                expect(input.decodedPubKey![0]).toBe(0x03);
            });
        });

        describe('P2PKH (Legacy)', () => {
            test('should decode compressed pubkey from scriptSig', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: `${DER_SIGNATURE} ${COMPRESSED_PUBKEY}`,
                        hex: '',
                    },
                    sequence: 4294967295,
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).not.toBeNull();
                expect(toHex(input.decodedPubKey!)).toBe(COMPRESSED_PUBKEY);
            });

            test('should decode uncompressed pubkey from scriptSig', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: `${DER_SIGNATURE} ${UNCOMPRESSED_PUBKEY}`,
                        hex: '',
                    },
                    sequence: 4294967295,
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).not.toBeNull();
                expect(toHex(input.decodedPubKey!)).toBe(UNCOMPRESSED_PUBKEY);
            });
        });

        describe('P2TR (Taproot)', () => {
            test('should NOT decode from key-path spend (1 witness element)', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [SCHNORR_SIGNATURE],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode from script-path spend with control block', () => {
                // P2TR script-path: [script args..., script, control_block]
                // Control block starts with 0xc0 or 0xc1
                const controlBlock =
                    'c0' + '50863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352';
                const script = '205120' + 'a'.repeat(64);

                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [SCHNORR_SIGNATURE, script, controlBlock],
                };

                const input = new TransactionInput(vin);

                // 3 witness elements, not 2, so decodePubKey returns null
                expect(input.decodedPubKey).toBeNull();
            });
        });

        describe('P2SH-P2WPKH (Nested SegWit)', () => {
            test('should decode pubkey from nested segwit witness', () => {
                // P2SH-P2WPKH has witness like P2WPKH plus a scriptSig with the redeem script
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: '0014' + PUBKEY_HASH_20_BYTES, // redeem script
                        hex: '160014' + PUBKEY_HASH_20_BYTES,
                    },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
                };

                const input = new TransactionInput(vin);

                // Witness still has 2 elements with pubkey, so it should decode
                expect(input.decodedPubKey).not.toBeNull();
                expect(toHex(input.decodedPubKey!)).toBe(COMPRESSED_PUBKEY);
            });
        });

        describe('P2WSH (SegWit Script Hash)', () => {
            test('should NOT decode from P2WSH multisig (more than 2 witness elements)', () => {
                // 2-of-3 multisig witness: [empty, sig1, sig2, redeemScript]
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [
                        '', // empty for CHECKMULTISIG bug
                        DER_SIGNATURE,
                        DER_SIGNATURE,
                        '5221' + COMPRESSED_PUBKEY + '21' + COMPRESSED_PUBKEY + '52ae',
                    ],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });
        });

        describe('P2WSH (SegWit Script Hash) with 65-byte script', () => {
            test('should NOT decode 65-byte witness script as uncompressed pubkey (bug fix for tx 0cf7a4e5...)', () => {
                // This is the actual failing transaction: 0cf7a4e5f2fbe5d4eaf52e0024815a83f177419871960e5a6f98ce9bc7c97837
                // The witness[1] is 65 bytes but it's a SCRIPT, not an uncompressed pubkey
                // Script starts with 0x21 (OP_PUSHBYTES_33), not 0x04 (uncompressed pubkey prefix)
                const witnessScript =
                    '21031d3e15f127324e6f4cb97fa08240b285cc8393def5f4393e4249e5af0471e960ac736476a91449a18b46b83a494765040c626a55c587b76f06d488ad53b268';

                const vin: VIn = {
                    txid: '5649ac4a1b3190fc88587ed46db6df7912f63ea4ba558b2a34183e4bed76f86b',
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967293, // 0xfffffffd
                    txinwitness: [
                        '304402206e3fe292634bdd360b240dda933c7507ddd0e81097d39791ac6a0d93a14f835b022020be76c3d3c34ecbdf93e91468884aafeb3edf6f9ee6952ffdffc27ef75b224f01',
                        witnessScript,
                    ],
                };

                const input = new TransactionInput(vin);

                // Verify witness[1] is 65 bytes (the bug condition)
                expect(input.transactionInWitness[1].length).toBe(65);
                // Verify first byte is NOT 0x04 (uncompressed pubkey prefix)
                expect(input.transactionInWitness[1][0]).toBe(0x21); // OP_PUSHBYTES_33
                expect(input.transactionInWitness[1][0]).not.toBe(0x04);

                // The fix: decodedPubKey should be null because this is a script, not a pubkey
                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode 33-byte witness script starting with non-pubkey prefix', () => {
                // A 33-byte script that starts with an opcode, not 0x02 or 0x03
                // Example: OP_1 (0x51) followed by 32 bytes of data
                const script33Bytes = '51' + 'a'.repeat(64); // 0x51 = OP_1

                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, script33Bytes],
                };

                const input = new TransactionInput(vin);

                expect(input.transactionInWitness[1].length).toBe(33);
                expect(input.transactionInWitness[1][0]).toBe(0x51); // OP_1, not a valid pubkey prefix
                expect(input.decodedPubKey).toBeNull();
            });

            test('should handle edge case: 33-byte script starting with 0x02 (OP_PUSHBYTES_2)', () => {
                // This is an edge case: a 33-byte script that starts with 0x02
                // 0x02 = OP_PUSHBYTES_2 in script context, but also compressed pubkey prefix (even y)
                // Script: OP_PUSHBYTES_2 <2 bytes> <30 bytes of opcodes>
                // This WILL be incorrectly identified as a pubkey, but it's extremely rare in practice
                // and the subsequent EC operations will fail, catching the error downstream
                const script = '02' + 'ab'.repeat(32); // 0x02 + 32 bytes = 33 bytes total

                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, script],
                };

                const input = new TransactionInput(vin);

                // Note: This will be identified as a pubkey due to prefix matching
                // In practice, EC operations will fail on invalid curve points
                expect(input.transactionInWitness[1].length).toBe(33);
                expect(input.transactionInWitness[1][0]).toBe(0x02);
                // This is a known limitation - prefix alone can't distinguish all cases
                // The fix handles the common case (0x21 prefix scripts)
            });

            test('should correctly decode REAL uncompressed pubkey (65 bytes, starts with 0x04)', () => {
                // A real uncompressed public key starts with 0x04
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, UNCOMPRESSED_PUBKEY],
                };

                const input = new TransactionInput(vin);

                expect(input.transactionInWitness[1].length).toBe(65);
                expect(input.transactionInWitness[1][0]).toBe(0x04); // Valid uncompressed prefix
                expect(input.decodedPubKey).not.toBeNull();
                expect(toHex(input.decodedPubKey!)).toBe(UNCOMPRESSED_PUBKEY);
            });
        });

        describe('Edge cases', () => {
            test('should NOT decode when witness has only 1 element', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode when witness is empty', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode when second witness is invalid length (32 bytes)', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, 'a'.repeat(64)], // 32 bytes
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode when second witness is invalid length (34 bytes)', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, 'a'.repeat(68)], // 34 bytes
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode when scriptSig has wrong number of parts', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: DER_SIGNATURE, // only 1 part
                        hex: '',
                    },
                    sequence: 4294967295,
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode when scriptSig second part is wrong length', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: `${DER_SIGNATURE} ${'a'.repeat(64)}`, // 32 bytes, not 33 or 65
                        hex: '',
                    },
                    sequence: 4294967295,
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode from scriptSig when 33-byte data has invalid prefix', () => {
                // scriptSig with 66 hex chars (33 bytes) but starts with 0x21 (OP_PUSHBYTES_33), not 0x02/0x03
                const invalidPubkey = '21' + 'a'.repeat(64); // 0x21 prefix, 33 bytes total

                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: `${DER_SIGNATURE} ${invalidPubkey}`,
                        hex: '',
                    },
                    sequence: 4294967295,
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode from scriptSig when 65-byte data has invalid prefix', () => {
                // scriptSig with 130 hex chars (65 bytes) but starts with 0x21, not 0x04
                const invalidPubkey = '21' + 'a'.repeat(128); // 0x21 prefix, 65 bytes total

                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: `${DER_SIGNATURE} ${invalidPubkey}`,
                        hex: '',
                    },
                    sequence: 4294967295,
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode when scriptSig.asm is empty', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: '',
                        hex: 'deadbeef',
                    },
                    sequence: 4294967295,
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should NOT decode when scriptSig is undefined', () => {
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    sequence: 4294967295,
                } as VIn;

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).toBeNull();
            });

            test('should prefer witness over scriptSig when both present', () => {
                const differentPubkey =
                    '03' + '50863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352';
                const vin: VIn = {
                    txid: VALID_TXID,
                    vout: 0,
                    scriptSig: {
                        asm: `${DER_SIGNATURE} ${COMPRESSED_PUBKEY}`,
                        hex: '',
                    },
                    sequence: 4294967295,
                    txinwitness: [DER_SIGNATURE, differentPubkey],
                };

                const input = new TransactionInput(vin);

                // Should use witness pubkey, not scriptSig pubkey
                expect(toHex(input.decodedPubKey!)).toBe(differentPubkey);
            });
        });

        describe('Real-world transaction data', () => {
            test('should decode from real P2WPKH spend (tx 8dac5e0f...)', () => {
                // Real data from the reported bug
                const vin: VIn = {
                    txid: '167b7289f84cd45ea867c518a1f84c57857e4142e08a5a970b192dc0d3a21230',
                    vout: 107,
                    scriptSig: { asm: '', hex: '' },
                    sequence: 4294967295,
                    txinwitness: [
                        '3045022100c2e78f7c69a0702d7585aa0631c42bf78e33a001bee9a1c2b6138e3801aade1402206378f959e00124defa8428d5b0396ffb53fd8504f0acbacaf00d7c153c3bab5901',
                        '0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b',
                    ],
                };

                const input = new TransactionInput(vin);

                expect(input.decodedPubKey).not.toBeNull();
                expect(toHex(input.decodedPubKey!)).toBe(
                    '0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b',
                );
            });
        });
    });

    // ==================== DECODE PUBKEY HASH TESTS ====================
    describe('decodePubKeyHash', () => {
        test('should decode 20-byte hash from witness[0] if present', () => {
            // This is an edge case - normally witness[0] is a signature
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [PUBKEY_HASH_20_BYTES, COMPRESSED_PUBKEY],
            };

            const input = new TransactionInput(vin);

            expect(input.decodedPubKeyHash).not.toBeNull();
            expect(toHex(input.decodedPubKeyHash!)).toBe(PUBKEY_HASH_20_BYTES);
            expect(input.decodedPubKeyHash!.length).toBe(20);
        });

        test('should decode 40-char hex hash from scriptSig', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: {
                    asm: `${DER_SIGNATURE} ${PUBKEY_HASH_20_BYTES}`,
                    hex: '',
                },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.decodedPubKeyHash).not.toBeNull();
            expect(toHex(input.decodedPubKeyHash!)).toBe(PUBKEY_HASH_20_BYTES);
        });

        test('should NOT decode when witness[0] is not 20 bytes', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY], // signature is ~71 bytes, not 20
            };

            const input = new TransactionInput(vin);

            expect(input.decodedPubKeyHash).toBeNull();
        });

        test('should NOT decode when scriptSig part is not 40 chars', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: {
                    asm: `${DER_SIGNATURE} ${'a'.repeat(38)}`, // 19 bytes
                    hex: '',
                },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.decodedPubKeyHash).toBeNull();
        });

        test('should NOT decode when witness has only 1 element', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [PUBKEY_HASH_20_BYTES],
            };

            const input = new TransactionInput(vin);

            expect(input.decodedPubKeyHash).toBeNull();
        });

        test('should NOT decode when witness is empty', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [],
            };

            const input = new TransactionInput(vin);

            expect(input.decodedPubKeyHash).toBeNull();
        });

        test('should NOT decode when scriptSig.asm is empty', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);

            expect(input.decodedPubKeyHash).toBeNull();
        });
    });

    // ==================== TO DOCUMENT TESTS ====================
    describe('toDocument', () => {
        test('should return document with all fields', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 5,
                scriptSig: { asm: 'test', hex: 'deadbeef' },
                sequence: 0xfffffffe,
                txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
            };

            const input = new TransactionInput(vin);
            const doc = input.toDocument();

            expect(doc.originalTransactionId).toBeInstanceOf(Uint8Array);
            expect(toHex(doc.originalTransactionId!)).toBe(VALID_TXID);
            expect(doc.outputTransactionIndex).toBe(5);
            expect(doc.scriptSignature).toEqual({ asm: 'test', hex: 'deadbeef' });
            expect(doc.sequenceId).toBe(0xfffffffe);
        });

        test('should exclude scriptSignature when hex is empty', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: 'test', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);
            const doc = input.toDocument();

            expect(doc.scriptSignature).toBeUndefined();
        });

        test('should exclude scriptSignature when undefined', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                sequence: 4294967295,
            } as VIn;

            const input = new TransactionInput(vin);
            const doc = input.toDocument();

            expect(doc.scriptSignature).toBeUndefined();
        });

        test('should not include witness data in document', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
            };

            const input = new TransactionInput(vin);
            const doc = input.toDocument();

            expect('transactionInWitness' in doc).toBe(false);
        });
    });

    // ==================== TO STRIPPED TESTS ====================
    describe('toStripped', () => {
        test('should return stripped input with basic fields', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 3,
                scriptSig: { asm: '', hex: 'aabbcc' },
                sequence: 4294967295,
                txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            expect(stripped.txId).toBeInstanceOf(Uint8Array);
            expect(stripped.outputIndex).toBe(3);
            expect(stripped.scriptSig).toBeInstanceOf(Uint8Array);
            expect(toHex(stripped.scriptSig)).toBe('aabbcc');
            expect(stripped.witnesses).toHaveLength(2);
        });

        test('should default outputIndex to 0 when undefined', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            } as VIn;

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            expect(stripped.outputIndex).toBe(0);
        });

        test('should handle empty scriptSig hex', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            expect(stripped.scriptSig.length).toBe(0);
        });

        test('should handle undefined scriptSig', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                sequence: 4294967295,
            } as VIn;

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            expect(stripped.scriptSig.length).toBe(0);
        });

        test('should include coinbase when present', () => {
            const coinbaseHex = '03a5b206deadbeef';
            const vin: VIn = {
                txid: '',
                vout: 4294967295,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                coinbase: coinbaseHex,
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            expect(stripped.coinbase).toBeInstanceOf(Uint8Array);
            expect(toHex(stripped.coinbase!)).toBe(coinbaseHex);
        });

        test('should set flags based on consensus settings', () => {
            const coinbaseHex = '03a5b206';
            const vin: VIn = {
                txid: '',
                vout: 4294967295,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                coinbase: coinbaseHex,
                txinwitness: [DER_SIGNATURE],
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            // Check that flags is a number (actual value depends on consensus config)
            expect(typeof stripped.flags).toBe('number');
        });

        test('should have flags field in stripped output with coinbase', () => {
            const coinbaseHex = '03a5b206';
            const vin: VIn = {
                txid: '',
                vout: 4294967295,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                coinbase: coinbaseHex,
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            // Flags should be present regardless of consensus settings
            expect('flags' in stripped).toBe(true);
            expect(typeof stripped.flags).toBe('number');
        });

        test('should have flags field in stripped output with witnesses', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            // Flags should be present regardless of consensus settings
            expect('flags' in stripped).toBe(true);
            expect(typeof stripped.flags).toBe('number');
        });

        test('should have flags field when no coinbase or witnesses', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [],
            };

            const input = new TransactionInput(vin);
            const stripped = input.toStripped();

            // Flags should be present and be a number
            expect('flags' in stripped).toBe(true);
            expect(typeof stripped.flags).toBe('number');
            // Without coinbase or witnesses, flags should be 0
            expect(stripped.flags).toBe(0);
        });
    });

    // ==================== WITNESS DATA HANDLING TESTS ====================
    describe('witness data handling', () => {
        test('witnesses should be Uint8Arrays not strings', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
            };

            const input = new TransactionInput(vin);

            expect(input.transactionInWitness[0]).toBeInstanceOf(Uint8Array);
            expect(input.transactionInWitness[1]).toBeInstanceOf(Uint8Array);
            expect(typeof input.transactionInWitness[0]).not.toBe('string');
        });

        test('witness Uint8Array length should be byte length not hex length', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [DER_SIGNATURE, COMPRESSED_PUBKEY],
            };

            const input = new TransactionInput(vin);

            // COMPRESSED_PUBKEY is 66 hex chars = 33 bytes
            expect(COMPRESSED_PUBKEY.length).toBe(66);
            expect(input.transactionInWitness[1].length).toBe(33);

            // DER_SIGNATURE is variable but should be about 71 bytes
            expect(input.transactionInWitness[0].length).toBeLessThan(DER_SIGNATURE.length);
        });

        test('should handle witnesses with varying lengths', () => {
            const shortWitness = 'aabb'; // 2 bytes
            const mediumWitness = 'a'.repeat(40); // 20 bytes
            const longWitness = 'a'.repeat(200); // 100 bytes

            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [shortWitness, mediumWitness, longWitness],
            };

            const input = new TransactionInput(vin);

            expect(input.transactionInWitness[0].length).toBe(2);
            expect(input.transactionInWitness[1].length).toBe(20);
            expect(input.transactionInWitness[2].length).toBe(100);
        });
    });

    // ==================== RAW TRANSACTION TESTS ====================
    describe('raw transaction hex parsing', () => {
        test('should correctly identify raw tx hex structure', () => {
            // Raw tx: 02000000000101167b7289f84cd45ea867c518a1f84c57857e4142e08a5a970b192dc0d3a212306b00000000ffffffff03...
            // This verifies we understand the raw tx structure for test purposes
            expect(RAW_TX_HEX.startsWith('02000000')).toBe(true); // version 2
            expect(RAW_TX_HEX.includes('0001')).toBe(true); // segwit marker
        });

        test('should have correct extracted witness data from raw tx', () => {
            // From the raw tx, the witness is:
            // 02 (2 items)
            // 48 (72 bytes signature)
            // 3045022100c2e78f7c69a0702d7585aa0631c42bf78e33a001bee9a1c2b6138e3801aade1402206378f959e00124defa8428d5b0396ffb53fd8504f0acbacaf00d7c153c3bab5901
            // 21 (33 bytes pubkey)
            // 0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b

            const vin: VIn = {
                txid: '167b7289f84cd45ea867c518a1f84c57857e4142e08a5a970b192dc0d3a21230',
                vout: 107, // 0x6b
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [
                    '3045022100c2e78f7c69a0702d7585aa0631c42bf78e33a001bee9a1c2b6138e3801aade1402206378f959e00124defa8428d5b0396ffb53fd8504f0acbacaf00d7c153c3bab5901',
                    '0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b',
                ],
            };

            const input = new TransactionInput(vin);

            // Verify witness parsing
            expect(input.transactionInWitness).toHaveLength(2);
            expect(input.transactionInWitness[0].length).toBe(72); // DER signature + sighash byte
            expect(input.transactionInWitness[1].length).toBe(33); // compressed pubkey

            // Verify pubkey decoding works (this was the bug!)
            expect(input.decodedPubKey).not.toBeNull();
            expect(toHex(input.decodedPubKey!)).toBe(
                '0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b',
            );
        });

        test('should decode pubkey for address bc1qsv66xtw050lmzcmdlragncpq7nqyvrrx78zszf', () => {
            // This test verifies the specific bug fix for the reported issue
            // Address bc1qsv66xtw050lmzcmdlragncpq7nqyvrrx78zszf has pubkey hash 8335a32dcfa3ffb1636df8fa89e020f4c0460c66
            // The pubkey that hashes to this is 0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b

            const vin: VIn = {
                txid: '167b7289f84cd45ea867c518a1f84c57857e4142e08a5a970b192dc0d3a21230',
                vout: 107,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [
                    '3045022100c2e78f7c69a0702d7585aa0631c42bf78e33a001bee9a1c2b6138e3801aade1402206378f959e00124defa8428d5b0396ffb53fd8504f0acbacaf00d7c153c3bab5901',
                    '0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b',
                ],
            };

            const input = new TransactionInput(vin);

            expect(input.decodedPubKey).not.toBeNull();
            expect(input.decodedPubKey![0]).toBe(0x02); // compressed pubkey, even y
            expect(input.decodedPubKey!.length).toBe(33);
        });
    });

    // ==================== COMBINED SCENARIOS ====================
    describe('combined scenarios', () => {
        test('coinbase transaction should have empty txid and special vout', () => {
            const vin: VIn = {
                txid: '',
                vout: 4294967295,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                coinbase: '03a5b206',
            };

            const input = new TransactionInput(vin);

            expect(input.originalTransactionId.length).toBe(0);
            expect(input.outputTransactionIndex).toBe(4294967295);
            expect(input.decodedPubKey).toBeNull();
            expect(input.decodedPubKeyHash).toBeNull();
        });

        test('full P2WPKH transaction input', () => {
            const vin: VIn = {
                txid: '167b7289f84cd45ea867c518a1f84c57857e4142e08a5a970b192dc0d3a21230',
                vout: 107,
                scriptSig: { asm: '', hex: '' },
                sequence: 4294967295,
                txinwitness: [
                    '3045022100c2e78f7c69a0702d7585aa0631c42bf78e33a001bee9a1c2b6138e3801aade1402206378f959e00124defa8428d5b0396ffb53fd8504f0acbacaf00d7c153c3bab5901',
                    '0205342657b688537da7ec3ac78536ea648c17b452fadd4536f1e98958797da57b',
                ],
            };

            const input = new TransactionInput(vin);

            // Verify all fields
            expect(toHex(input.originalTransactionId)).toBe(
                '167b7289f84cd45ea867c518a1f84c57857e4142e08a5a970b192dc0d3a21230',
            );
            expect(input.outputTransactionIndex).toBe(107);
            expect(input.sequenceId).toBe(4294967295);
            expect(input.transactionInWitness).toHaveLength(2);
            expect(input.decodedPubKey).not.toBeNull();
            expect(input.decodedPubKey!.length).toBe(33);

            // Verify document
            const doc = input.toDocument();
            expect(doc.outputTransactionIndex).toBe(107);

            // Verify stripped
            const stripped = input.toStripped();
            expect(stripped.outputIndex).toBe(107);
            expect(stripped.witnesses).toHaveLength(2);
        });

        test('full P2PKH transaction input', () => {
            const vin: VIn = {
                txid: VALID_TXID,
                vout: 0,
                scriptSig: {
                    asm: `${DER_SIGNATURE} ${COMPRESSED_PUBKEY}`,
                    hex: '48' + DER_SIGNATURE + '21' + COMPRESSED_PUBKEY,
                },
                sequence: 4294967293, // RBF enabled
            };

            const input = new TransactionInput(vin);

            expect(input.transactionInWitness).toHaveLength(0);
            expect(input.decodedPubKey).not.toBeNull();
            expect(toHex(input.decodedPubKey!)).toBe(COMPRESSED_PUBKEY);
            expect(input.sequenceId).toBe(4294967293);

            const doc = input.toDocument();
            expect(doc.scriptSignature?.hex).toBeTruthy();
        });
    });
});
