export function isEmptyBuffer(buffer: Buffer | Uint8Array): boolean {
    for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] !== 0) {
            return false;
        }
    }

    return true;
}
