import { createHash } from 'node:crypto';
import { BinaryReader } from '../buffer/BinaryReader.js';

export enum ABIDataTypes {
    UINT8 = 'UINT8',
    UINT16 = 'UINT16',
    UINT32 = 'UINT32',
    BOOL = 'BOOL',
    ADDRESS = 'ADDRESS',
    STRING = 'STRING',
    BYTES32 = 'BYTES32',
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
            }
        }

        return result;
    }

    public encodePointer(pointer: number, key: string): string {
        const hash = this.sha256(pointer.toString() + key);
        const selector = hash.slice(0, 32); // 32 bytes

        return selector.toString('hex');
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

    private sha256(buffer: Buffer | string): Buffer {
        return createHash('sha256').update(buffer).digest();
    }
}
