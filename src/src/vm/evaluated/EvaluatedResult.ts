import { NetEvent } from '../events/NetEvent.js';

export interface EvaluatedResult {
    result: Uint8Array | undefined;
    events: NetEvent[] | undefined;
}
