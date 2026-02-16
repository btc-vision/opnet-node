import {
    _toFutureSegwitAddress,
    Network,
    opcodes,
    payments,
    Script,
    script,
    toFutureOPNetAddress,
} from '@btc-vision/bitcoin';
import { createPublicKey } from '@btc-vision/ecpair';

export interface ScriptAddress {
    /** Single address when one exists (P2PKH, P2SH, bech32, …) */
    address?: string;
    /**
     * For bare‐multisig we expose every constituent key’s P2PKH address
     * (same idea as Bitcoin Core’s “addresses” array).
     */
    addresses?: string[];
    /** Bitcoin Core–style script classification */
    type:
        | 'pubkey'
        | 'pubkeyhash'
        | 'scripthash'
        | 'multisig'
        | 'nulldata'
        | 'witness_v0_keyhash'
        | 'witness_v0_scripthash'
        | 'witness_v1_taproot'
        | 'witness_unknown'
        | 'witness_mweb_hogaddr'
        | 'opnet'
        | 'future-segwit'
        | 'nonstandard';
}

export function scriptToAddress(output: Buffer, network: Network): ScriptAddress {
    const outputScript = new Uint8Array(output) as Script;

    if (output[0] === opcodes.OP_RETURN) {
        return { type: 'nulldata' };
    }

    try {
        return { address: payments.p2pkh({ output: outputScript, network }).address, type: 'pubkeyhash' };
    } catch {}

    try {
        return { address: payments.p2sh({ output: outputScript, network }).address, type: 'scripthash' };
    } catch {}

    if ((output.length === 35 || output.length === 67) && output.at(-1) === opcodes.OP_CHECKSIG) {
        return { type: 'pubkey' };
    }

    try {
        return {
            address: payments.p2wpkh({ output: outputScript, network }).address,
            type: 'witness_v0_keyhash',
        };
    } catch {}

    try {
        return {
            address: payments.p2wsh({ output: outputScript, network }).address,
            type: 'witness_v0_scripthash',
        };
    } catch {}

    try {
        return { address: payments.p2tr({ output: outputScript, network }).address, type: 'witness_v1_taproot' };
    } catch {}

    try {
        return { address: toFutureOPNetAddress(output, network), type: 'witness_unknown' };
    } catch {}

    try {
        const chunks = script.decompile(output);
        if (!chunks) throw new Error('cant-decode');

        // pattern:  OP_m  <pubkey>…  OP_n  OP_CHECKMULTISIG
        const last = chunks.length - 1;
        const second = chunks.length - 2;
        if (chunks[last] !== opcodes.OP_CHECKMULTISIG) throw new Error('not-multisig');
        if (typeof chunks[0] !== 'number' || typeof chunks[second] !== 'number')
            throw new Error('not-mn');

        const pubKeys = chunks.slice(1, second) as Uint8Array[];
        if (!pubKeys.length) throw new Error('no-keys');

        const addresses = pubKeys
            .map((pk) => payments.p2pkh({ pubkey: createPublicKey(pk), network }).address)
            .filter((addr): addr is string => typeof addr === 'string');

        return { addresses: addresses, type: 'multisig' };
    } catch {} // fall through if the pattern didn’t match

    try {
        return { address: _toFutureSegwitAddress(output, network), type: 'witness_unknown' };
    } catch {}

    return { type: 'nonstandard' };
}
