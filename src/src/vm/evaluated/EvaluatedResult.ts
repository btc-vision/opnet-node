import { BlockchainStorage, NetEvent } from '@btc-vision/bsi-binary';

export interface EvaluatedResult {
    changedStorage: BlockchainStorage;
    result: Uint8Array | undefined;
    events: NetEvent[] | undefined;
    gasUsed: bigint;
}
