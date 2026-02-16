import { isZero } from '@btc-vision/bitcoin';

export function isEmptyBuffer(buffer: Uint8Array): boolean {
    return isZero(buffer);
}
