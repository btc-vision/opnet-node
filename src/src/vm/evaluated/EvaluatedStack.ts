import { Contract } from '../contracts/Contract.js';
import { EvaluatedResult } from './EvaluatedResult.js';

export interface EvaluatedStack {
    readonly logs: string[] | null;
    readonly errors: string[] | null;

    readonly contract: Readonly<Contract> | null;

    readonly result: Partial<EvaluatedResult> | null;
}
