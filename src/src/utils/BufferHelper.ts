import { Decimal128 } from 'mongodb';
import { MemorySlotPointer } from '../vm/buffer/types/math.js';

export class BufferHelper {
    public static readonly EXPECTED_BUFFER_LENGTH: number = 32;

    public static bufferToUint8Array(buffer: Buffer | Uint8Array): Uint8Array {
        if (Buffer.isBuffer(buffer)) {
            const length: number = buffer.byteLength;
            const arrayBuffer: ArrayBuffer = new ArrayBuffer(length);

            const view: Uint8Array = new Uint8Array(arrayBuffer);
            for (let i = 0; i < length; ++i) {
                view[i] = buffer[i];
            }

            return view;
        }

        return buffer;
    }

    public static uint8ArrayToHex(input: Uint8Array): string {
        return Buffer.from(input, 0, input.byteLength).toString('hex');
    }
    
    public static hexToUint8Array(input: string): Uint8Array {
        if (input.startsWith('0x')) {
            input = input.substr(2);
        }

        if (input.length % 2 !== 0) {
            input = '0' + input;
        }

        const length = input.length / 2;
        const buffer = new Uint8Array(length);

        for (let i = 0; i < length; i++) {
            buffer[i] = parseInt(input.substr(i * 2, 2), 16);
        }

        return buffer;

        //const buf = Buffer.from(input, 'hex');
        //return new Uint8Array(buf, 0, buf.byteLength);
    }

    public static fromDecimal128(value: Decimal128): bigint {
        return BigInt(value.toString());
    }

    public static toDecimal128(value: bigint): Decimal128 {
        return Decimal128.fromString(value.toString());
    }

    public static pointerToUint8Array(pointer: MemorySlotPointer): Uint8Array {
        const pointerHex = pointer.toString(16).padStart(64, '0');

        return BufferHelper.hexToUint8Array(pointerHex);
    }

    public static uint8ArrayToPointer(input: Uint8Array): MemorySlotPointer {
        const hex = BufferHelper.uint8ArrayToHex(input);

        return BigInt('0x' + hex) as MemorySlotPointer;
    }

    public static valueToUint8Array(value: bigint): Uint8Array {
        const valueHex = value.toString(16).padStart(64, '0');

        return BufferHelper.hexToUint8Array(valueHex);
    }

    public static uint8ArrayToValue(input: Uint8Array): bigint {
        const hex = BufferHelper.uint8ArrayToHex(input);

        if (!hex) return BigInt(0);

        return BigInt('0x' + hex);
    }
}
