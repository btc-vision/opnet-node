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
import { VMContext } from '../../src/src/vm/evaluated/EvaluatedContext.js';
import { ContractEvaluator } from '../../src/src/vm/runtime/ContractEvaluator.js';
import { VMManager } from '../../src/src/vm/VMManager.js';
import { VMRuntime } from '../../src/src/vm/wasmRuntime/runDebug.js';
import { TestConfig } from '../config/Config.js';

describe('Anyone should be able to deploy a Bitcoin Smart Contract (BSC).', () => {
    let CONTRACT_ADDRESS: string = 'bc1p3hnqcq7jq6k30ryv8lfzx3ruuvkwr7gu50xz4acweqv4a7sj44cq9jhmq5';

    const DEPLOYER_ADDRESS = BitcoinHelper.generateWallet();
    const RANDOM_BLOCK_ID: bigint = 1073478347n;

    const abiCoder: ABICoder = new ABICoder();
    const vmManager: VMManager = new VMManager(TestConfig);

    let OWNER = DEPLOYER_ADDRESS.address;

    let decodedViewSelectors: SelectorsMap;
    let decodedMethodSelectors: MethodMap;

    let mainContractViewSelectors: PropertyABIMap | undefined;
    let mainContractMethodSelectors: ContractABIMap | undefined;

    let vmEvaluator: ContractEvaluator | null = null;
    let vmContext: VMContext | null = null;
    let vmRuntime: VMRuntime | null = null;
    let contractRef: Number = 0;

    //let CONTRACT_ADDRESS: string = '';

    beforeAll(async () => {
        await vmManager.init();
        await vmManager.prepareBlock(RANDOM_BLOCK_ID);

        const contractBytecode: Buffer = fs.readFileSync('bytecode/contract.wasm');
        expect(contractBytecode).toBeDefined();

        vmContext = await vmManager.loadContractFromBytecode(contractBytecode);
        expect(vmContext).toBeDefined();

        if (vmContext.contract === null) {
            throw new Error('Contract not found.');
        }

        vmEvaluator = vmContext.contract;

        vmRuntime = vmContext.contract.wasm;
        expect(vmRuntime).toBeDefined();

        if (!vmRuntime) {
            throw new Error('VM runtime not found.');
        }

        let REAL_CONTRACT_ADDRESS = BitcoinHelper.generateNewContractAddress(
            contractBytecode,
            DEPLOYER_ADDRESS.publicKey,
        );

        if (!CONTRACT_ADDRESS) {
            CONTRACT_ADDRESS = REAL_CONTRACT_ADDRESS;
        }

        console.log(`Bitcoin Smart Contract will be deployed at: ${CONTRACT_ADDRESS} by ${OWNER}`);

        await vmEvaluator.setupContract(OWNER, CONTRACT_ADDRESS);
        contractRef = vmEvaluator.getContract();

        const abi: Uint8Array = vmRuntime.getViewABI();
        const abiDecoder = new BinaryReader(abi);

        decodedViewSelectors = abiDecoder.readViewSelectorsMap();
        let methodSelectors: Uint8Array = vmRuntime.getMethodABI();

        abiDecoder.setBuffer(methodSelectors);

        decodedMethodSelectors = abiDecoder.readMethodSelectorsMap();

        console.log('ABI ->', decodedViewSelectors, decodedMethodSelectors);

        expect(decodedViewSelectors.has(CONTRACT_ADDRESS)).toBeTruthy();
        expect(decodedMethodSelectors.has(CONTRACT_ADDRESS)).toBeTruthy();

        mainContractViewSelectors = decodedViewSelectors.get(CONTRACT_ADDRESS);
        mainContractMethodSelectors = decodedMethodSelectors.get(CONTRACT_ADDRESS);
    });

    afterAll(async () => {
        await vmManager.terminateBlock();
        await vmManager.closeDatabase();
    });

    test(`ABI should be defined.`, async () => {
        expect(decodedViewSelectors).toBeDefined();
        expect(decodedMethodSelectors).toBeDefined();
        expect(module).toBeDefined();
    });

    test(`Computed selectors should be equal to wasm selectors.`, async () => {
        const selector = abiCoder.encodeSelector('isAddressOwner');
        const _selectorWASM = decodedMethodSelectors.values().next().value.values().next().value;
        const selectorWASM = abiCoder.numericSelectorToHex(_selectorWASM);

        expect(selector).toBe(selectorWASM);
    });

    test(`When I deploy a smart contract on the bitcoin network, it should have a valid address.`, async () => {
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

    test(`BSC should create new memory slots when required and be able to run any given method by their method selector.`, async () => {
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

        vmRuntime.purgeMemory();

        const balanceOfSelector = Number(`0x` + abiCoder.encodeSelector('balanceOf'));
        const hasTotalSupply = mainContractMethodSelectors.has(balanceOfSelector);
        if (!hasTotalSupply) {
            throw new Error('balanceOf selector not found');
        }

        const calldata: BinaryWriter = new BinaryWriter();
        calldata.writeAddress(OWNER);

        const buffer = calldata.getBuffer();

        const ownerValue = vmRuntime.readMethod(balanceOfSelector, contractRef, buffer, null);
        const decodedResponse = abiCoder.decodeData(ownerValue, [ABIDataTypes.UINT256]);

        const requiredStorageSlots = vmRuntime.getRequiredStorage();
        const modifiedStorageSlots = vmRuntime.getModifiedStorage();

        const binaryReader = new BinaryReader(requiredStorageSlots);
        const decodedRequiredStorage = binaryReader.readRequestedStorage();

        binaryReader.setBuffer(modifiedStorageSlots);
        const decodedModifiedStorage = binaryReader.readStorage();

        console.log('Storage ->', {
            requiredStorage: decodedRequiredStorage,
            modifiedStorage: decodedModifiedStorage,

            logs: vmContext?.logs,
        });

        expect(decodedRequiredStorage.size).toBe(1);
        expect(decodedModifiedStorage.size).toBe(1);

        const balanceOfResponse = decodedResponse[0];
        expect(balanceOfResponse).toBe(0n);
    });

    test(`BSC should be able to retrieve any storage key and value.`, async () => {});

    test(`BSC should be able to return every storage slot used when evaluating a method.`, async () => {});
});
