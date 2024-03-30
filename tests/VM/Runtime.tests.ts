import 'jest';
import { ABICoder } from '../../src/src/vm/abi/ABICoder.js';
import {
    BinaryReader,
    ContractABIMap,
    MethodMap,
    PropertyABIMap,
    SelectorsMap,
} from '../../src/src/vm/buffer/BinaryReader.js';

describe('I should be able to create my own smart contract for Bitcoin.', () => {
    const OWNER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const CONTRACT_ADDRESS = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';

    let module: MotoSwapFactory | null = null;
    let moduleWasm: Awaited<typeof wasm.promise>;

    let decodedViewSelectors: SelectorsMap;
    let decodedMethodSelectors: MethodMap;

    let mainContractViewSelectors: PropertyABIMap | undefined;
    let mainContractMethodSelectors: ContractABIMap | undefined;

    const abiCoder: ABICoder = new ABICoder();

    beforeEach(async () => {
        moduleWasm = await wasm.promise;

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
        expect(module).toBeDefined();
    });

    it('Contract owner should be owner.', async () => {
        expect(module).toBeDefined();
        expect(decodedViewSelectors).toBeDefined();
        expect(decodedMethodSelectors).toBeDefined();

        if (!mainContractMethodSelectors) {
            throw new Error('Method not found');
        }

        if (!mainContractViewSelectors) {
            throw new Error('ABI not found');
        }

        if (!module) {
            throw new Error('Module not found');
        }

        const ownerSelector = mainContractViewSelectors.get('owner');
        if (!ownerSelector) {
            throw new Error('Owner selector not found');
        }

        const ownerValue = moduleWasm.readView(ownerSelector);
        const decodedResponse = abiCoder.decodeData(ownerValue, [ABIDataTypes.ADDRESS]);

        expect(decodedResponse[0]).toBe(OWNER);
    });

    /*it('Contract owner to be owner2', async () => {
        expect(module).toBeDefined();
        expect(decodedViewSelectors).toBeDefined();
        expect(decodedMethodSelectors).toBeDefined();

        if (!module) {
            throw new Error('Module not found');
        }

    });*/
});
