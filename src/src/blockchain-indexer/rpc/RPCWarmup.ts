// Bitcoin Core answers RPC during startup but rejects every call with RPC error
// code -28 (RPC_IN_WARMUP) until the block index has finished loading. The RPC
// client only surfaces the error message string (not the numeric code), so the
// warmup condition is detected by matching the known message fragments below.

// How long to wait between retries while Bitcoin Core is still warming up.
export const RPC_WARMUP_RETRY_INTERVAL_MS: number = 2000;

// Lower-cased fragments of the messages Bitcoin Core returns while warming up.
const RPC_WARMUP_MESSAGES: readonly string[] = [
    'loading block index',
    'verifying blocks',
    'loading wallet',
    'rewinding blocks',
    'replaying blocks',
    'activating best chain',
    'loading p2p addresses',
    'loading banlist',
    'pruning',
    'warmup',
    'warming up',
    'starting up',
];

export function isRPCWarmupError(message: string): boolean {
    const lower = message.toLowerCase();

    return RPC_WARMUP_MESSAGES.some((fragment) => lower.includes(fragment));
}

export function rpcWarmupDelay(ms: number = RPC_WARMUP_RETRY_INTERVAL_MS): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
