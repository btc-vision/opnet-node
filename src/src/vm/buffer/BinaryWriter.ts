import { BinaryReader } from './BinaryReader.js';
import {
    Address,
    ADDRESS_BYTE_LENGTH,
    BlockchainStorage,
    i32,
    MethodMap,
    PointerStorage,
    PropertyABIMap,
    Selector,
    SelectorsMap,
    u16,
    u32,
    u64,
    u8,
} from './types/math.js';

export class BinaryWriter {
    private currentOffset: u32 = 0;
    private buffer: DataView = new DataView(new ArrayBuffer(ADDRESS_BYTE_LENGTH));

    constructor() {}

    public writeU8(value: u8): void {
        this.allocSafe(1);
        this.buffer.setUint8(this.currentOffset++, value);
    }

    public writeU16(value: u16): void {
        this.allocSafe(2);
        this.buffer.setUint16(this.currentOffset, value, true);
        this.currentOffset += 2;
    }

    public writeU32(value: u32): void {
        this.allocSafe(4);
        this.buffer.setUint32(this.currentOffset, value, true);
        this.currentOffset += 4;
    }

    public writeU64(value: u64): void {
        this.writeU32(Number(value));
        this.writeU32(Number(value >> 32n));
    }

    public writeSelector(value: Selector): void {
        this.writeU32(value);
    }

    public writeBoolean(value: boolean): void {
        this.writeU8(value ? 1 : 0);
    }

    public writeU256(bigIntValue: bigint): void {
        // Step 2: Iterate over BigInt value in 64-bit (8 bytes) chunks
        for (let i = 0n; i < 4n; i++) {
            // Extract 64-bit (8-byte) chunk from the BigInt
            const chunk = (bigIntValue >> (64n * i)) & BigInt('0xFFFFFFFFFFFFFFFF');

            // Step 3: Write the chunk to the DataView
            // JavaScript's DataView does not support writing BigInt directly, so split into two 32-bit parts
            const high = Number(chunk >> 32n);
            const low = Number(chunk & BigInt('0xFFFFFFFF'));

            // Write each part to the DataView
            this.writeU32(high);
            this.writeU32(low);
        }
    }

    public writeBytes(value: Uint8Array): void {
        for (let i = 0; i < value.length; i++) {
            this.writeU8(value[i]);
        }
    }

    public writeString(value: string): void {
        for (let i: i32 = 0; i < value.length; i++) {
            this.writeU8(value.charCodeAt(i));
        }
    }

    public writeAddress(value: Address): void {
        const bytes = this.fromAddress(value);

        this.writeBytes(bytes);
    }

    public writeStringWithLength(value: string): void {
        this.writeU16(value.length);

        this.writeString(value);
    }

    public writeViewSelectorMap(map: SelectorsMap): void {
        this.writeU16(map.size);

        map.forEach(
            (value: PropertyABIMap, key: string, _map: Map<string, PropertyABIMap>): void => {
                this.writeAddress(key);
                this.writeSelectors(value);
            },
        );
    }

    public writeMethodSelectorsMap(map: MethodMap): void {
        this.writeU16(map.size);

        map.forEach(
            (value: Set<Selector>, key: Address, _map: Map<Address, Set<Selector>>): void => {
                this.writeAddress(key);
                this.writeMethodSelectorMap(value);
            },
        );
    }

    public getBuffer(): Uint8Array {
        const buf = new Uint8Array(this.buffer.byteLength);
        for (let i: u32 = 0; i < this.buffer.byteLength; i++) {
            buf[i] = this.buffer.getUint8(i);
        }

        this.clear();

        return buf;
    }

    public reset(): void {
        this.currentOffset = 0;

        this.buffer = new DataView(new ArrayBuffer(4));
    }

    public writeStorage(storage: BlockchainStorage): void {
        this.reset();
        this.writeU32(storage.size);

        const keys: Address[] = Array.from(storage.keys());
        const values: PointerStorage[] = Array.from(storage.values());

        for (let i: i32 = 0; i < keys.length; i++) {
            const address: Address = keys[i];
            const slots: Map<u64, u64> = values[i];

            this.writeAddress(address);
            this.writeU32(slots.size);

            const slotKeys: u64[] = Array.from(slots.keys());
            for (let j: i32 = 0; j < slotKeys.length; j++) {
                const slot: u64 = slotKeys[j];
                this.writeU256(slot);

                const slotValue = slots.get(slot);
                if (slotValue === undefined || slotValue === null) {
                    throw new Error(`Slot value not found.`);
                }

                this.writeU256(slotValue);
            }
        }
    }

    public toBytesReader(): BinaryReader {
        return new BinaryReader(this.getBuffer());
    }

    public getOffset(): u32 {
        return this.currentOffset;
    }

    public setOffset(offset: u32): void {
        this.currentOffset = offset;
    }

    public clear(): void {
        this.currentOffset = 0;
        this.buffer = new DataView(new ArrayBuffer(4));
    }

    public allocSafe(size: u32): void {
        if (this.currentOffset + size > this.buffer.byteLength) {
            this.resize(size);
        }
    }

    public writeABISelector(name: string, selector: Selector): void {
        this.writeStringWithLength(name);
        this.writeSelector(selector);
    }

    private writeMethodSelectorMap(value: Set<Selector>): void {
        this.writeU16(value.size);

        value.forEach((selector: Selector, _value: Selector, _set: Set<Selector>): void => {
            this.writeSelector(selector);
        });
    }

    private writeSelectors(value: PropertyABIMap): void {
        this.writeU16(value.size);

        value.forEach((selector: Selector, key: string, _map: Map<string, Selector>): void => {
            this.writeABISelector(key, selector);
        });
    }

    private fromAddress(value: Address): Uint8Array {
        const bytes: Uint8Array = new Uint8Array(ADDRESS_BYTE_LENGTH);

        for (let i: i32 = 0; i < value.length; i++) {
            bytes[i] = value.charCodeAt(i);
        }

        return bytes;
    }

    private resize(size: u32): void {
        const buf: Uint8Array = new Uint8Array(this.buffer.byteLength + size);

        for (let i: i32 = 0; i < this.buffer.byteLength; i++) {
            buf[i] = this.buffer.getUint8(i);
        }

        this.buffer = new DataView(buf.buffer);
    }
}
