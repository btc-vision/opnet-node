import 'jest';

import fs from 'fs';
import { BitcoinHelper } from '../../src/src/bitcoin/BitcoinHelper.js';
import { ABICoder, ABIDataTypes } from '../../src/src/vm/abi/ABICoder.js';
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
import { TestConfig } from '../config/Config.js';

describe('Anyone should be able to deploy a Bitcoin Smart Contract (BSC).', () => {
    let CONTRACT_ADDRESS: string = 'bc1p3hnqcq7jq6k30ryv8lfzx3ruuvkwr7gu50xz4acweqv4a7sj44cq9jhmq5';

    const DEPLOYER_ADDRESS = BitcoinHelper.generateWallet();
    const RANDOM_BLOCK_ID: bigint = 1073478347n;

    const abiCoder: ABICoder = new ABICoder();
    const vmManager: VMManager = new VMManager(TestConfig);

    let OWNER: string = '13sBQqJdnAdc7v5tnX3ifYqAMoFX79VfLy'; //DEPLOYER_ADDRESS.address;

    let decodedViewSelectors: SelectorsMap;
    let decodedMethodSelectors: MethodMap;

    let mainContractViewSelectors: PropertyABIMap | undefined;
    let mainContractMethodSelectors: ContractABIMap | undefined;

    let vmEvaluator: ContractEvaluator | null = null;
    let vmContext: VMContext | null = null;
    let loaded: Promise<void> | null = null;

    async function load() {
        loaded = new Promise<void>(async (resolve, reject) => {
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

            let REAL_CONTRACT_ADDRESS = BitcoinHelper.generateNewContractAddress(
                contractBytecode,
                DEPLOYER_ADDRESS.publicKey,
            );

            if (!CONTRACT_ADDRESS) {
                CONTRACT_ADDRESS = REAL_CONTRACT_ADDRESS;
            }

            console.log(
                `Bitcoin Smart Contract will be deployed at: ${CONTRACT_ADDRESS} by ${OWNER}`,
            );

            await vmEvaluator.setupContract(OWNER, CONTRACT_ADDRESS);

            decodedViewSelectors = vmEvaluator.getViewSelectors();
            decodedMethodSelectors = vmEvaluator.getMethodSelectors();

            expect(decodedViewSelectors.has(CONTRACT_ADDRESS)).toBeTruthy();
            expect(decodedMethodSelectors.has(CONTRACT_ADDRESS)).toBeTruthy();

            mainContractViewSelectors = decodedViewSelectors.get(CONTRACT_ADDRESS);
            mainContractMethodSelectors = decodedMethodSelectors.get(CONTRACT_ADDRESS);

            if (!vmEvaluator) {
                throw new Error('VM runtime not found.');
            }

            const isInitialized = vmEvaluator.isInitialized();
            expect(isInitialized).toBeTruthy();

            resolve();
        });

        return await loaded;
    }

    beforeAll(async () => {
        await load();
    });

    afterAll(async () => {
        if (vmManager) {
            await vmManager.terminateBlock();
            await vmManager.closeDatabase();
        }
    });

    test(`ABI should be defined.`, async () => {
        await loaded;

        expect(decodedViewSelectors).toBeDefined();
        expect(decodedMethodSelectors).toBeDefined();
        expect(module).toBeDefined();
    });

    test(`Computed selectors should be equal to wasm selectors.`, async () => {
        await loaded;

        const selector = abiCoder.encodeSelector('isAddressOwner');
        const _selectorWASM = decodedMethodSelectors.values().next().value.values().next().value;
        const selectorWASM = abiCoder.numericSelectorToHex(_selectorWASM);

        expect(selector).toBe(selectorWASM);
    });

    test(`When I deploy a smart contract on the bitcoin network, it should have a valid address.`, async () => {
        if (!vmEvaluator) {
            throw new Error('VM evaluator not found.');
        }

        const isInitialized = vmEvaluator.isInitialized();
        expect(isInitialized).toBeTruthy();

        expect(mainContractViewSelectors).toBeDefined();
        expect(mainContractMethodSelectors).toBeDefined();

        if (!mainContractMethodSelectors) {
            throw new Error('Method not found');
        }

        if (!mainContractViewSelectors) {
            throw new Error('ABI not found');
        }

        if (!vmEvaluator) {
            throw new Error('VM evaluator not found.');
        }

        const ownerSelector = mainContractViewSelectors.get('owner');
        if (!ownerSelector) {
            throw new Error('Owner selector not found');
        }

        const ownerValue = await vmEvaluator.execute(CONTRACT_ADDRESS, true, ownerSelector);
        if (!ownerValue) {
            throw new Error('Owner value not found');
        }

        const decodedResponse = abiCoder.decodeData(ownerValue, [ABIDataTypes.ADDRESS]);
        expect(decodedResponse[0]).toBe(OWNER);
    });

    test(`BSC should create new memory slots when required and be able to run any given method by their method selector.`, async () => {
        expect(mainContractViewSelectors).toBeDefined();
        expect(mainContractMethodSelectors).toBeDefined();

        if (!vmEvaluator) {
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

        const balanceOfSelector = Number(`0x` + abiCoder.encodeSelector('balanceOf'));
        const hasTotalSupply = mainContractMethodSelectors.has(balanceOfSelector);
        if (!hasTotalSupply) {
            throw new Error('balanceOf selector not found');
        }

        const calldata: BinaryWriter = new BinaryWriter();
        calldata.writeAddress(OWNER);

        const buffer = calldata.getBuffer();

        const balanceValue = await vmEvaluator.execute(
            CONTRACT_ADDRESS,
            true,
            balanceOfSelector,
            buffer,
        );

        if (!balanceValue) {
            throw new Error('Balance value not found');
        }

        const decodedResponse = abiCoder.decodeData(balanceValue, [ABIDataTypes.UINT256]);
        const balanceOfResponse = decodedResponse[0];

        expect(balanceOfResponse).toBe(0n);
    });

    test(`BSC should be able to compute basic operations such as additions and set the corresponding storage slot correctly.`, async () => {
        expect(mainContractViewSelectors).toBeDefined();
        expect(mainContractMethodSelectors).toBeDefined();

        if (!vmEvaluator) {
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

        /*const ptr = abiCoder.encodePointer(OWNER);
                                    const calculatedPointer = abiCoder.encodePointerHash(1, ptr);

                                    console.log('Pointer ->', ptr, calculatedPointer);

                                    vmManager.clearFakeStorage();
                                    vmManager.setFakeStorage(CONTRACT_ADDRESS, 0, 0, 1n);*/

        const balanceOfSelector = Number(`0x` + abiCoder.encodeSelector('balanceOf'));
        const hasTotalSupply = mainContractMethodSelectors.has(balanceOfSelector);
        if (!hasTotalSupply) {
            throw new Error('balanceOf selector not found');
        }

        const calldata: BinaryWriter = new BinaryWriter();
        calldata.writeAddress(OWNER);

        const buffer = calldata.getBuffer();
        const balanceValue = await vmEvaluator.execute(
            CONTRACT_ADDRESS,
            true,
            balanceOfSelector,
            buffer,
        );

        if (!balanceValue) {
            throw new Error('Balance value not found');
        }

        const decodedResponse = abiCoder.decodeData(balanceValue, [ABIDataTypes.UINT256]);
        const balanceOfUserBeforeAddition = decodedResponse[0] as bigint;

        const addBalanceSelector = Number(`0x` + abiCoder.encodeSelector('addFreeMoney'));
        const addCalldata: BinaryWriter = new BinaryWriter();
        addCalldata.writeAddress(OWNER);
        addCalldata.writeU256(100n);

        const addBuffer = addCalldata.getBuffer();

        await vmEvaluator.execute(CONTRACT_ADDRESS, false, addBalanceSelector, addBuffer);

        const balanceValueAfterAddition = await vmEvaluator.execute(
            CONTRACT_ADDRESS,
            true,
            balanceOfSelector,
            buffer,
        );

        if (!balanceValueAfterAddition) {
            throw new Error('Balance value not found');
        }

        const decodedResponseAfterAddition = abiCoder.decodeData(balanceValueAfterAddition, [
            ABIDataTypes.UINT256,
        ]);
        const balanceOfUserAfterAddition = decodedResponseAfterAddition[0] as bigint;

        console.log('Balance of user before addition:', balanceOfUserBeforeAddition);
        console.log('Balance of user after addition:', balanceOfUserAfterAddition);

        expect(balanceOfUserAfterAddition).toBeGreaterThan(balanceOfUserBeforeAddition);
    });
});
