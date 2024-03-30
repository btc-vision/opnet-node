import { Contract } from '../contracts/Contract.js';
import { EvaluatedABI } from './EvaluatedABI.js';

export class ABIFactory {
    constructor() {}

    public generateABIForContract(contract: Contract): EvaluatedABI {
        return {};
    }
}
