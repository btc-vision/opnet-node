import { createHash } from 'node:crypto';
import { BufferHelper } from '../../utils/BufferHelper.js';
import { BinaryReader } from '../buffer/BinaryReader.js';

export enum ABIDataTypes {
    UINT8 = 'UINT8',
    UINT16 = 'UINT16',
    UINT32 = 'UINT32',
    BOOL = 'BOOL',
    ADDRESS = 'ADDRESS',
    STRING = 'STRING',
    BYTES32 = 'BYTES32',
    UINT256 = 'UINT256',
}

export class ABICoder {
    constructor() {}

    public decodeData(data: Uint8Array, types: ABIDataTypes[]): unknown[] {
        const byteReader = new BinaryReader(data);
        const result: unknown[] = [];

        for (let i = 0; i < types.length; i++) {
            const type = types[i];
            switch (type) {
                case ABIDataTypes.UINT8:
                    result.push(byteReader.readU8());
                    break;
                case ABIDataTypes.UINT16:
                    result.push(byteReader.readU16());
                    break;
                case ABIDataTypes.UINT32:
                    result.push(byteReader.readU32());
                    break;
                case ABIDataTypes.BYTES32:
                    result.push(byteReader.readBytes(32));
                    break;
                case ABIDataTypes.BOOL:
                    result.push(byteReader.readBoolean());
                    break;
                case ABIDataTypes.ADDRESS:
                    result.push(byteReader.readAddress());
                    break;
                case ABIDataTypes.STRING:
                    result.push(byteReader.readStringWithLength());
                    break;
                case ABIDataTypes.UINT256:
                    result.push(byteReader.readU256());
                    break;
            }
        }

        return result;
    }

    public encodePointer(key: string): bigint {
        const hash = this.sha256(key);
        const finalBuffer = Buffer.alloc(BufferHelper.EXPECTED_BUFFER_LENGTH);
        const selector = hash.slice(0, BufferHelper.EXPECTED_BUFFER_LENGTH); // 32 bytes

        for (let i = 0; i < BufferHelper.EXPECTED_BUFFER_LENGTH; i++) {
            finalBuffer[i] = selector[i];
        }

        return BigInt('0x' + finalBuffer.toString('hex'));
    }

    public encodePointerHash(pointer: number, sub: bigint): Uint8Array {
        const finalBuffer = new Uint8Array(BufferHelper.EXPECTED_BUFFER_LENGTH + 2); // 32 bytes for `sub` + 2 bytes for `pointer`
        // Encode pointer
        finalBuffer[0] = pointer & 0xff;
        finalBuffer[1] = (pointer >> 8) & 0xff;

        // Convert `sub` to Uint8Array and append it
        const subKey = this.bigIntToUint8Array(sub, BufferHelper.EXPECTED_BUFFER_LENGTH); // Assuming a function to convert BigInt to Uint8Array of fixed size
        finalBuffer.set(subKey, 2);

        const hashed = this.sha256(finalBuffer);
        if (hashed.byteLength !== BufferHelper.EXPECTED_BUFFER_LENGTH) {
            throw new Error('Invalid hash length');
        }

        return hashed;
    }

    public encodeSelector(selectorIdentifier: string): string {
        // first 4 bytes of sha256 hash of the function signature
        const hash = this.sha256(selectorIdentifier);
        const selector = hash.slice(0, 4); // 4 bytes

        return selector.toString('hex');
    }

    public numericSelectorToHex(selector: number): string {
        return selector.toString(16);
    }

    private bigIntToUint8Array(bigIntValue: bigint, length: number): Uint8Array {
        const byteArray = new Uint8Array(length);
        const buf = BufferHelper.valueToUint8Array(bigIntValue);

        for (let i = 0; i < length; i++) {
            byteArray[i] = buf[i] || 0;
        }

        return byteArray;
    }

    private sha256(buffer: Buffer | string | Uint8Array): Buffer {
        return createHash('sha256').update(buffer).digest();
    }
}
