import 'jest';
import fs from 'fs';
import { BitcoinHelper } from '../../src/src/bitcoin/BitcoinHelper.js';
import { ABICoder, ABIDataTypes } from '../../src/src/vm/abi/ABICoder.js';
import { BinaryReader } from '../../src/src/vm/buffer/BinaryReader.js';
import { BinaryWriter } from '../../src/src/vm/buffer/BinaryWriter.js';
import {
    ContractABIMap,
    MethodMap,
    PropertyABIMap,
    SelectorsMap,
} from '../../src/src/vm/buffer/types/math.js';
import { VMManager } from '../../src/src/vm/VMManager.js';
import { VMRuntime } from '../../src/src/vm/wasmRuntime/runDebug.js';

describe('Anyone should be able to deploy a Bitcoin Smart Contract (BSC).', () => {
    const DEPLOYER_ADDRESS = BitcoinHelper.generateWallet();

    const abiCoder: ABICoder = new ABICoder();
    const vmManager: VMManager = new VMManager();

    let OWNER = DEPLOYER_ADDRESS.address;

    let decodedViewSelectors: SelectorsMap;
    let decodedMethodSelectors: MethodMap;

    let mainContractViewSelectors: PropertyABIMap | undefined;
    let mainContractMethodSelectors: ContractABIMap | undefined;

    let vmRuntime: VMRuntime | null = null;

    beforeEach(async () => {
        const contractBytecode: Buffer = fs.readFileSync('bytecode/contract.wasm');
        expect(contractBytecode).toBeDefined();

        const vmContext = await vmManager.loadContractFromBytecode(contractBytecode);
        expect(vmContext).toBeDefined();

        vmRuntime = vmContext.contract;
        expect(vmRuntime).toBeDefined();

        if (!vmRuntime) {
            throw new Error('VM runtime not found.');
        }

        const CONTRACT_ADDRESS = BitcoinHelper.generateNewContractAddress(
            contractBytecode,
            DEPLOYER_ADDRESS.publicKey,
        );

        console.log(`Bitcoin Smart Contract will be deployed at: ${CONTRACT_ADDRESS} by ${OWNER}`);

        vmRuntime.INIT(OWNER, CONTRACT_ADDRESS);

        const abi: Uint8Array = vmRuntime.getViewABI();
        const abiDecoder = new BinaryReader(abi);

        decodedViewSelectors = abiDecoder.readViewSelectorsMap();
        let methodSelectors: Uint8Array = vmRuntime.getMethodABI();

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

    it(`When I deploy a smart contract on the bitcoin network, it should have a valid address.`, async () => {
        expect(mainContractViewSelectors).toBeDefined();
        expect(mainContractMethodSelectors).toBeDefined();

        if (!vmRuntime) {
            throw new Error('VM runtime not found.');
        }

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

        const ownerValue = vmRuntime.readView(ownerSelector);
        const decodedResponse = abiCoder.decodeData(ownerValue, [ABIDataTypes.ADDRESS]);

        expect(decodedResponse[0]).toBe(OWNER);
    });

    it(`I should be able to interact with a readonly method in my contract.`, async () => {
        expect(mainContractViewSelectors).toBeDefined();
        expect(mainContractMethodSelectors).toBeDefined();

        if (!vmRuntime) {
            throw new Error('VM runtime not found.');
        }

        if (!mainContractMethodSelectors) {
            throw new Error('Method not found');
        }

        if (!mainContractViewSelectors) {
            throw new Error('ABI not found');
        }

        if (!module) {
            throw new Error('Module not found');
        }

        const totalSupplySelector = Number(`0x` + abiCoder.encodeSelector('totalSupply'));
        console.log(totalSupplySelector);

        const hasTotalSupply = mainContractMethodSelectors.has(totalSupplySelector);
        if (!hasTotalSupply) {
            throw new Error('Owner selector not found');
        }

        const calldata: BinaryWriter = new BinaryWriter();

        const ownerValue = vmRuntime.readMethod(totalSupplySelector, calldata);
        const decodedResponse = abiCoder.decodeData(ownerValue, [ABIDataTypes.ADDRESS]);

        expect(decodedResponse[0]).toBe(OWNER);
    });
});
