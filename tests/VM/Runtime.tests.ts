import 'jest';
import fs from 'fs';
import { ABICoder } from '../../src/src/vm/abi/ABICoder.js';
import { VMManager } from '../../src/src/vm/VMManager.js';

describe('I should be able to create my own smart contract for Bitcoin.', () => {
    const OWNER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const CONTRACT_ADDRESS = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';

    const abiCoder: ABICoder = new ABICoder();
    const vmManager: VMManager = new VMManager();

    beforeEach(async () => {
        /*moduleWasm = await wasm.promise;

        if (!moduleWasm) {
            throw new Error('Module not found');
        }

        module = moduleWasm.CONTRACT(OWNER, CONTRACT_ADDRESS);

        const abi: Uint8Array = moduleWasm.getViewABI();
        const abiDecoder = new BinaryReader(abi);

        decodedViewSelectors = abiDecoder.readViewSelectorsMap();
        let methodSelectors: Uint8Array = moduleWasm.getMethodABI();

        abiDecoder.setBuffer(methodSelectors);

        decodedMethodSelectors = abiDecoder.readMethodSelectorsMap();

        const selector = abiCoder.encodeSelector('isAddressOwner');
        const _selectorWASM = decodedMethodSelectors.values().next().value.values().next().value;
        const selectorWASM = abiCoder.numericSelectorToHex(_selectorWASM);

        console.log('ABI ->', decodedViewSelectors, decodedMethodSelectors, {
            selectorComputed: selector,
            selectorWASM: selectorWASM,
        });

        expect(decodedViewSelectors.has(CONTRACT_ADDRESS)).toBeTruthy();
        expect(decodedMethodSelectors.has(CONTRACT_ADDRESS)).toBeTruthy();

        mainContractViewSelectors = decodedViewSelectors.get(CONTRACT_ADDRESS);
        mainContractMethodSelectors = decodedMethodSelectors.get(CONTRACT_ADDRESS);

        expect(decodedViewSelectors).toBeDefined();
        expect(decodedMethodSelectors).toBeDefined();
        expect(module).toBeDefined();*/
    });

    it(`Should be able to load a contract from its bytecode.`, async () => {
        const contractBytecode: Buffer = fs.readFileSync('bytecode/contract.wasm');
        const contract = await vmManager.loadContractFromBytecode(contractBytecode);

        console.log(contract);

        expect(contractBytecode).toBeDefined();
    });
});
