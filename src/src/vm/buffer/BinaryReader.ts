const ADDRESS_BYTE_LENGTH: number = 62;

type Address = string;
type i32 = number;
type u8 = number;
type u16 = number;
type u32 = number;
type f32 = number;

export type Selector = number;

export interface ABIRegistryItem {
    name: string,
    selector: Selector
}

export type ContractABIMap = Set<Selector>;
export type PropertyABIMap = Map<string, Selector>;
export type SelectorsMap = Map<Address, PropertyABIMap>;
export type MethodMap = Map<Address, ContractABIMap>;

export class BinaryReader {
    private buffer: DataView;

    private currentOffset: i32 = 0;

    constructor(bytes: Uint8Array) {
        this.buffer = new DataView(bytes.buffer);
    }

    public setBuffer(bytes: Uint8Array): void {
        this.buffer = new DataView(bytes.buffer);

        this.currentOffset = 0;
    }

    public readSelectors(): PropertyABIMap {
        const selectors: PropertyABIMap = new Map();
        const length = this.readU16();

        for (let i = 0; i < length; i++) {
            const selectorData = this.readABISelector();

            selectors.set(selectorData.name, selectorData.selector);
        }

        return selectors;
    }

    public readABISelector(): ABIRegistryItem {
        const name = this.readStringWithLength();
        const selector = this.readSelector();

        return {
            name,
            selector,
        };
    }

    public readViewSelectorsMap(): SelectorsMap {
        const map: SelectorsMap = new Map();

        const length = this.readU16();
        for (let i = 0; i < length; i++) {
            const key = this.readAddress();
            const value = this.readSelectors();

            map.set(key, value);
        }

        return map;
    }

    public readMethodSelectorsMap(): MethodMap {
        const map: MethodMap = new Map();
        const length = this.readU16();

        for (let i = 0; i < length; i++) {
            const key = this.readAddress();
            const value = this.readMethodSelectors();

            map.set(key, value);
        }

        return map;
    }

    public readMethodSelectors(): ContractABIMap {
        const selectors: ContractABIMap = new Set();
        const length = this.readU16();

        for (let i = 0; i < length; i++) {
            selectors.add(this.readSelector());
        }

        return selectors;
    }

    public readU8(): u8 {
        this.verifyEnd(this.currentOffset + 1);

        return this.buffer.getUint8(this.currentOffset++);
    }

    public readU16(): u16 {
        this.verifyEnd(this.currentOffset + 2);

        const value = this.buffer.getUint16(this.currentOffset, true);
        this.currentOffset += 2;

        return value;
    }

    public readU32(): u32 {
        this.verifyEnd(this.currentOffset + 4);

        const value = this.buffer.getUint32(this.currentOffset, true);
        this.currentOffset += 4;
        return value;
    }

    public readU64(): bigint {
        const low = BigInt(this.readU32());
        const high = BigInt(this.readU32());

        return (BigInt(high) << 32n) | low;
    }

    public readBytes(length: u32, zeroStop: boolean = false): Uint8Array {
        let bytes = new Uint8Array(length);
        this.verifyEnd(this.currentOffset + length);

        for (let i: u32 = 0; i < length; i++) {
            const byte = this.readU8();
            if (zeroStop && byte == 0) {
                bytes = bytes.slice(0, i);
                continue;
            }

            bytes[i] = byte;
        }

        return bytes;
    }

    public readString(length: u16): string {
        const textDecoder = new TextDecoder();
        const bytes = this.readBytes(length, true);

        return textDecoder.decode(bytes);
    }

    public readSelector(): Selector {
        return this.readU32();
    }

    public readStringWithLength(): string {
        const length = this.readU16();

        return this.readString(length);
    }

    public readBoolean(): boolean {
        return this.readU8() !== 0;
    }

    public readFloat(): f32 {
        const value = this.buffer.getFloat32(this.currentOffset, true);
        this.currentOffset += 4;

        return value;
    }

    public readDouble(): number {
        const value = this.buffer.getFloat64(this.currentOffset, true);
        this.currentOffset += 8;

        return value;
    }

    public readAddress(): Address {
        return this.readString(ADDRESS_BYTE_LENGTH);
    }

    public getOffset(): u16 {
        return this.currentOffset;
    }

    public setOffset(offset: u16): void {
        this.currentOffset = offset;
    }

    public verifyEnd(size: i32): void {
        if (this.currentOffset > this.buffer.byteLength) {
            throw new Error(`Expected to read ${size} bytes but read ${this.currentOffset} bytes`);
        }
    }
}
