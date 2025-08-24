export enum Features {
    ACCESS_LIST = 0b1,
    EPOCH_SUBMISSION = 0b10,
}

export interface Feature<T extends Features> {
    opcode: T;
    data: unknown;
}

export interface AccessListFeature extends Feature<Features.ACCESS_LIST> {
    data: Buffer;
}

export interface EpochSubmissionFeature extends Feature<Features.EPOCH_SUBMISSION> {
    data: Buffer;
}
