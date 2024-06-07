import { BlockchainStorage, NetEvent } from '@btc-vision/bsi-binary';
import { Address } from '@btc-vision/bsi-binary/src/buffer/types/math.js';

export type EvaluatedEvents = Map<Address, NetEvent[]>;

export interface EvaluatedResult {
    readonly changedStorage: BlockchainStorage;
    readonly result: Uint8Array | undefined;
    readonly events: EvaluatedEvents | undefined;
    readonly gasUsed: bigint;
}
