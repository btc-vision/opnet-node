import { Binary } from 'mongodb';

export interface IContractPointerValueDocument {
    readonly contractAddress: string;
    readonly pointer: Binary;
    readonly value: Binary;
}
