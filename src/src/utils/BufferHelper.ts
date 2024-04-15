import { MemorySlotPointer } from '../vm/buffer/types/math.js';

export class BufferHelper {
    public static bufferToUint8Array(buffer: Buffer): Uint8Array {
        const arrayBuffer = new ArrayBuffer(buffer.length);

        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < buffer.length; ++i) {
            view[i] = buffer[i];
        }

        return view;
    }

    public static uint8ArrayToHex(input: Uint8Array): string {
        return Buffer.from(input, 0, input.length).toString('hex');
    }

    public static hexToUint8Array(input: string): Uint8Array {
        if (input.length % 2 !== 0) {
            input = '0' + input;
        }

        if (typeof Buffer !== 'undefined') {
            const buf = Buffer.from(input, 'hex');
            return new Uint8Array(buf, 0, buf.length);
        } else {
            throw new Error('Buffer is not defined');
        }
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
