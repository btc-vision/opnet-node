import { threadId } from 'worker_threads';

/**
 * Flip this to false (or delete the call sites) once the broadcast / block
 * processed stall has been located. Every trace line is tagged [BTRACE] so the
 * whole lot can be grepped or stripped in one pass.
 */
export const BCAST_TRACE_ENABLED = true;

/**
 * High-visibility, cross-thread trace line. Each entry carries an epoch-ms
 * timestamp (t=) and the emitting worker's thread id (tid=) so a stall shows up
 * as a gap between two consecutive lines, and so messages can be followed as
 * they cross from one thread to another.
 */
export function btrace(tag: string, message: string, data?: unknown): void {
    if (!BCAST_TRACE_ENABLED) {
        return;
    }

    const now = Date.now();
    const suffix = data === undefined ? '' : ` :: ${safeStringify(data)}`;

    // eslint-disable-next-line no-console
    console.log(`[BTRACE t=${now} tid=${threadId}] ${tag} | ${message}${suffix}`);
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, (_key, current: unknown) => {
            if (typeof current === 'bigint') {
                return current.toString();
            }

            if (current instanceof Uint8Array) {
                return `Uint8Array(${current.byteLength})`;
            }

            return current;
        });
    } catch {
        return '[unserializable]';
    }
}
