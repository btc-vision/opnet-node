import { Agent, setGlobalDispatcher } from 'undici';

// Hard ceiling on how long we wait for Bitcoin Core to answer a single RPC call.
// Bitcoin Core sends the full HTTP response only once it has finished processing
// the call, so a wedged or unresponsive node sends no bytes at all — that case is
// caught by headersTimeout (time-to-first-byte). Without this, the underlying
// fetch() never settles, so the awaiting promise chain (and every closure it
// pins: raw tx bytes, thread task resolvers, etc.) is retained forever, which is
// what leaks memory when Bitcoin Core stops responding.
export const BITCOIN_RPC_TIMEOUT_MS: number = 15_000;

let installed: boolean = false;

/**
 * Install a process(thread)-wide undici dispatcher that aborts any fetch() to
 * Bitcoin Core which has not produced a response within the given timeout.
 *
 * Node's global fetch() (used by @btc-vision/bitcoin-rpc) routes through undici's
 * global dispatcher, so setting it here applies to every Bitcoin Core RPC call
 * made from THIS worker only — each worker thread is its own isolate with its own
 * global dispatcher, so this must be called once per worker that talks to Core.
 * Idempotent: safe to call more than once.
 *
 * headersTimeout (time-to-first-byte) is the lever that catches a wedged or
 * unresponsive node, since Bitcoin Core only sends the HTTP response once it has
 * finished processing the call.
 *
 * bodyTimeout is the max gap between body reads. For small responses (broadcast,
 * testmempoolaccept, call, getblockheight) the default of `timeoutMs` is correct.
 * For workers that stream large bodies (block sync via getblockbatch) pass
 * `bodyTimeoutMs = 0` to disable it, so a legitimately slow large-block download
 * is not aborted mid-stream while still bounding time-to-first-byte.
 */
export function installBitcoinRPCTimeout(
    timeoutMs: number = BITCOIN_RPC_TIMEOUT_MS,
    bodyTimeoutMs: number = timeoutMs,
): void {
    if (installed) {
        return;
    }

    installed = true;

    setGlobalDispatcher(
        new Agent({
            headersTimeout: timeoutMs,
            bodyTimeout: bodyTimeoutMs,
            connect: { timeout: timeoutMs },
        }),
    );
}
