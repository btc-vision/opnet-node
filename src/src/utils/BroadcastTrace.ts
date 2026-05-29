import { threadId } from 'worker_threads';
import fs from 'fs';

/**
 * Flip this to false (or delete the call sites) once the broadcast / block
 * processed stall has been located. Every trace line is tagged [BTRACE] so the
 * whole lot can be grepped or stripped in one pass.
 */
export const BCAST_TRACE_ENABLED = true;

/**
 * When set, every trace line is ALSO appended to this file (in addition to
 * stdout). All worker threads append to the same file; O_APPEND keeps each
 * single-line write atomic, so lines from different threads interleave cleanly
 * without corrupting each other. Relative to the process cwd (the node starts
 * with `cd build`, so this lands at build/btrace.log). Set to '' to disable
 * file output and keep stdout only.
 */
const BCAST_TRACE_FILE: string = './btrace.log';

let stream: fs.WriteStream | undefined;
let streamFailed: boolean = false;

function getStream(): fs.WriteStream | undefined {
    if (!BCAST_TRACE_FILE || streamFailed) {
        return undefined;
    }

    if (!stream) {
        try {
            stream = fs.createWriteStream(BCAST_TRACE_FILE, { flags: 'a' });
            stream.on('error', () => {
                streamFailed = true;
            });
        } catch {
            streamFailed = true;
            return undefined;
        }
    }

    return stream;
}

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
    const line = `[BTRACE t=${now} tid=${threadId}] ${tag} | ${message}${suffix}`;

    // eslint-disable-next-line no-console
    console.log(line);

    const s = getStream();
    if (s) {
        try {
            s.write(`${line}\n`);
        } catch {
            streamFailed = true;
        }
    }
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
