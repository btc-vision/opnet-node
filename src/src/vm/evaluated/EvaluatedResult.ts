import { BlockchainStorage } from '../buffer/types/math.js';
import { NetEvent } from '../events/NetEvent.js';

export interface EvaluatedResult {
    changedStorage: BlockchainStorage;
    result: Uint8Array | undefined;
    events: NetEvent[] | undefined;
}
