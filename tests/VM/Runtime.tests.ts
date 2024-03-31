import 'jest';
import fs from 'fs';
import { BitcoinHelper } from '../../src/src/bitcoin/BitcoinHelper.js';
import { ABICoder } from '../../src/src/vm/abi/ABICoder.js';
import { VMManager } from '../../src/src/vm/VMManager.js';

describe('Anyone should be able to deploy a Bitcoin Smart Contract (BSC).', () => {
    const OWNER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const CONTRACT_ADDRESS = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';

    const DEPLOYER_ADDRESS = BitcoinHelper.generateWallet();

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

    it(`When I deploy a smart contract on the bitcoin network, it should have a valid address.`, async () => {
        const contractBytecode: Buffer = fs.readFileSync('bytecode/contract.wasm');
        expect(contractBytecode).toBeDefined();

        const vmContext = await vmManager.loadContractFromBytecode(contractBytecode);
        expect(vmContext).toBeDefined();

        const vmRuntime = vmContext.contract;
        expect(vmRuntime).toBeDefined();

        if (!vmRuntime) {
            throw new Error('VM runtime not found.');
        }

        const generatedContract = BitcoinHelper.generateNewContractAddress(
            contractBytecode,
            DEPLOYER_ADDRESS.publicKey,
        );

        console.log(`Bitcoin Smart Contract will be deployed at: ${generatedContract}`);

        //vmRuntime.INIT(OWNER, CONTRACT_ADDRESS);
    });
});
