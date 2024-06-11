import { Address } from '@btc-vision/bsi-binary';

export interface ExternalCallResponse {
    readonly response: Uint8Array;
}

export type ExternalCallsResult = Map<Address, ExternalCallResponse[]>;
export type ExternalCalls = Map<Address, Uint8Array[]>;
