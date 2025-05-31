import { LRUCache } from 'lru-cache';
import { crypto as btcCrypto } from '@btc-vision/bitcoin';

import { AnyoneCanSpendDetector, AnyoneCanSpendReason } from './AnyoneCanSpendDetector.js';
import { ScriptSolver } from './ScriptSolver.js';
import { TransactionOutput } from '../../processor/transaction/inputs/TransactionOutput.js';

export interface Utxo {
    txid: string;
    output: TransactionOutput;
}

const detector = new AnyoneCanSpendDetector();
const solver = new ScriptSolver();

type ScriptType = NonNullable<TransactionOutput['scriptPubKey']['type']>;

const STANDARD_TYPES = new Set<ScriptType>([
    'pubkey', // P2PK
    'pubkeyhash', // P2PKH
    'scripthash', // P2SH
    'witness_v0_keyhash', // P2WPKH
    'witness_v0_scripthash', // P2WSH
    'witness_v1_taproot', // P2TR
]);

const isStandardScript = (
    out: TransactionOutput,
): out is TransactionOutput & {
    scriptPubKey: { type: ScriptType };
} => STANDARD_TYPES.has(out.scriptPubKey.type as ScriptType);

export interface Classification {
    outpoint: { txid: string; index: number };
    status: 'Standard' | 'ACS' | 'Solved' | 'Unknown' | 'Unspendable' | 'Error';
    hit?: ReturnType<typeof detector.detect>;
    unlocking?: Uint8Array[];
    policyUnsafe?: boolean;
    sats: number;
    hex: string;
}

const solverCache: LRUCache<string, Uint8Array[]> = new LRUCache<string, Uint8Array[]>({
    max: 65_536,
});

const h256 = (u: Uint8Array) => btcCrypto.sha256(Buffer.from(u)).toString('hex');

export class UtxoSorter {
    public static async classifyBatch(
        utxos: readonly Utxo[],
        chain: { height: number; mtp: number },
        bruteMax: bigint = 32n,
    ): Promise<Classification[]> {
        const prelim: (Classification | null)[] = utxos.map(({ txid, output }) => {
            if (isStandardScript(output)) {
                return null;
            }

            const hit = detector.detect(output, chain.height, chain.mtp);
            if (!hit) {
                return {
                    outpoint: { txid, index: output.index },
                    status: 'Unknown',
                    sats: Number(output.value),
                    hex: output.scriptPubKey.hex,
                };
            }

            if (hit.reason === AnyoneCanSpendReason.ProvablyUnspendable) {
                return {
                    outpoint: { txid, index: output.index },
                    status: 'Unspendable',
                    hit,
                    sats: Number(output.value),
                    hex: output.scriptPubKey.hex,
                };
            }

            let unlocking: Uint8Array[] = [];
            if (
                hit.reason === AnyoneCanSpendReason.ZeroOfNMultisig &&
                hit.dummyPushes !== undefined
            ) {
                unlocking = Array.from({ length: hit.dummyPushes }, () => Uint8Array.of(0x00));
            }

            return {
                outpoint: { txid, index: output.index },
                status: 'ACS',
                hit,
                unlocking,
                policyUnsafe: hit.policyUnsafe ?? false,
                sats: Number(output.value),
                hex: output.scriptPubKey.hex,
            };
        });

        await Promise.all(
            prelim.map(async (cl, i) => {
                if (!cl) return; // skip standard outputs
                if (cl.status !== 'Unknown') return;

                const { output } = utxos[i];
                const key = h256(output.scriptPubKeyBuffer);
                const cache = solverCache.get(key);
                if (cache) {
                    cl.status = 'Solved';
                    cl.unlocking = cache;
                    return;
                }

                try {
                    const res = await solver.solve(
                        output.scriptPubKeyBuffer.toString('hex'),
                        bruteMax,
                    );
                    if (res.solved) {
                        cl.status = 'Solved';
                        cl.unlocking = res.stack;
                        solverCache.set(key, res.stack);
                    }
                } catch (error) {
                    console.error(
                        `Error solving script for ${output.scriptPubKeyBuffer.toString('hex')}:`,
                        error,
                    );

                    cl.status = 'Error';
                }
            }),
        );

        const stkHash = (s?: Uint8Array[]) => (!s ? '' : h256(Uint8Array.from(s.flat())));
        const bucket = new Map<string, Uint8Array[]>();

        for (const c of prelim) {
            if (!c) continue; // skip standard outputs
            if (!c.unlocking?.length) continue; // ignore empty/undefined

            const h = stkHash(c.unlocking);
            if (!bucket.has(h)) bucket.set(h, c.unlocking ?? []);
            c.unlocking = bucket.get(h);
        }

        return prelim.filter((c) => {
            if (!c) return false; // skip standard outputs

            if (c.status === 'Standard') return false; // skip standard outputs
            if (c.status === 'Unspendable') return false; // skip unspendable outputs

            return true; // keep ACS, Solved, and Unknown outputs
        }) as Classification[];
    }
}
