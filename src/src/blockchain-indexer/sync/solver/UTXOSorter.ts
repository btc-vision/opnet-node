import { LRUCache } from 'lru-cache';
import { crypto as btcCrypto } from '@btc-vision/bitcoin';

import { AnyoneCanSpendDetector, AnyoneCanSpendReason } from './AnyoneCanSpendDetector.js';
import { Logger } from '@btc-vision/bsi-common';
import { TransactionOutput } from '../../processor/transaction/inputs/TransactionOutput.js';

export interface Utxo {
    txid: string;
    output: TransactionOutput;
}

export interface ChainContext {
    height: number; // Current block height
    mtp: number; // Median time past of the current block
}

const detector = new AnyoneCanSpendDetector();
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
    status: 'Standard' | 'ACS' | 'Solved' | 'Unknown' | 'Unspendable' | 'Error' | 'InvalidScript';
    reason?: string;
    hit?: ReturnType<typeof detector.detect>;
    unlocking?: Uint8Array;
    policyUnsafe?: boolean;
    sats: number;
    hex: string;
}

const solverCache: LRUCache<string, Uint8Array> = new LRUCache<string, Uint8Array>({
    max: 65_536,
});

const h256 = (u: Uint8Array) => btcCrypto.sha256(Buffer.from(u)).toString('hex');

export class UtxoSorter extends Logger {
    public readonly logColor: string = '#ff9100'; // Bright green for UTXO sorter logs

    public async classifyBatch(
        utxos: readonly Utxo[],
        chain: ChainContext,
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
                unlocking: this.unlock(unlocking),
                policyUnsafe: hit.policyUnsafe ?? false,
                sats: Number(output.value),
                hex: output.scriptPubKey.hex,
            };
        });

        //await Promise.all(
        prelim.map((cl, i) => {
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

            if (!cl.outpoint.txid) {
                throw new Error(`Missing txid for output at index ${i}`);
            }

            return {
                status: 'Unknown',
                outpoint: cl.outpoint,
                sats: cl.sats,
                hex: cl.hex,
            };
        });
        //);

        const stkHash = (s?: Uint8Array) => (!s ? '' : h256(s));
        const bucket = new Map<string, Uint8Array>();

        for (const c of prelim) {
            if (!c) continue; // skip standard outputs
            if (!c.unlocking?.length) continue; // ignore empty/undefined

            const h = stkHash(c.unlocking);
            if (!bucket.has(h)) bucket.set(h, c.unlocking ?? Uint8Array.of());
            c.unlocking = bucket.get(h);
        }

        return prelim.filter((c) => {
            if (!c) return false; // skip standard outputs

            if (c.status === 'Standard') return false; // skip standard outputs
            if (c.status === 'Unspendable') return false; // skip unspendable outputs

            return true; // keep ACS, Solved, and Unknown outputs
        }) as Classification[];
    }

    private unlock(stack: Uint8Array[]): Uint8Array {
        return Uint8Array.from(stack.reduce<number[]>((a, b) => (a.push(...b), a), []));
    }
}
