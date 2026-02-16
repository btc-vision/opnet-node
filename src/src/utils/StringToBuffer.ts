import { fromHex } from '@btc-vision/bitcoin';

export function stringToBuffer(str: string): Uint8Array {
    return fromHex(str.replace('0x', ''));
}
