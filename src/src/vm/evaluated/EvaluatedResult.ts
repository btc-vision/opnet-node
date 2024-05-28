import { BlockchainStorage, NetEvent } from '@btc-vision/bsi-binary';
import { Address } from '@btc-vision/bsi-binary/src/buffer/types/math.js';

export type EvaluatedEvents = Map<Address, NetEvent[]>;

export interface EvaluatedResult {
    changedStorage: BlockchainStorage;
    result: Uint8Array | undefined;
    events: EvaluatedEvents | undefined;
    gasUsed: bigint;
}
