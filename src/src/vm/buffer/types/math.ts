export const ADDRESS_BYTE_LENGTH: number = 62;

export type Address = string;
export type i32 = number;
export type u8 = number;
export type u16 = number;
export type u32 = number;
export type f32 = number;

export type u64 = bigint;

export type Selector = number;

export interface ABIRegistryItem {
    name: string,
    selector: Selector
}

export type ContractABIMap = Set<Selector>;
export type PropertyABIMap = Map<string, Selector>;
export type SelectorsMap = Map<Address, PropertyABIMap>;
export type MethodMap = Map<Address, ContractABIMap>;
