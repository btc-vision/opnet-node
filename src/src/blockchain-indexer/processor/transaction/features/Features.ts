export enum Features {
    ACCESS_LIST = 0b1,
}

export interface Feature<T extends Features> {
    opcode: T;
    data: unknown;
}

export interface AccessListFeature extends Feature<Features.ACCESS_LIST> {
    data: Buffer;
}
