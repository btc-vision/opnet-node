import 'jest';
import {
    ABICoder,
    ABIDataTypes,
    BinaryWriter,
    ContractABIMap,
    MethodMap,
    PropertyABIMap,
    SelectorsMap,
} from '@btc-vision/bsi-binary';
import fs from 'fs';
import { ContractEvaluator } from '../../src/src/vm/runtime/ContractEvaluator.js';
import { VMIsolator } from '../../src/src/vm/VMIsolator.js';
import { VMManager } from '../../src/src/vm/VMManager.js';
import { TestConfig } from '../config/Config.js';

function generateRndAddress(length: number = 60): string {
    const characters = 'abcdef0123456789';
    let result = 'bc1p';

    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return result;
}

describe('Anyone should be able to deploy a Bitcoin Smart Contract (BSC).', () => {
    const ANY_CONTRACT_ADDRESS: string =
        'bc1p442922d62defabdd0fa6b3b25d565c9a7aabf1def5cf038e0d12c3e931f0'; // generateRndAddress();

    const ANY_OWNER: string = '13sBQqJdnAdc7v5tnX3ifYqAMoFX79VfLy';

    const RANDOM_BLOCK_ID: bigint = 1073478347n;
    const EXECUTE_X_TIME: bigint = 10n;
    const BALANCE_TO_ADD: bigint = 10n;

    const abiCoder: ABICoder = new ABICoder();
    const vmManager: VMManager = new VMManager(TestConfig);

    let decodedViewSelectors: SelectorsMap;
    let decodedMethodSelectors: MethodMap;

    let mainContractViewSelectors: PropertyABIMap | undefined;
    let mainContractMethodSelectors: ContractABIMap | undefined;

    let vmEvaluator: ContractEvaluator | null = null;
    let vmContext: VMIsolator | null = null;

    async function load() {
        const contractBytecode: Buffer = fs.readFileSync('bytecode/contract.wasm');
        expect(contractBytecode).toBeDefined();

        vmContext = await vmManager.loadContractFromBytecode(
            ANY_CONTRACT_ADDRESS,
            contractBytecode,
        );

        expect(vmContext).toBeDefined();

        if (!vmContext) {
            throw new Error('VM context not found.');
        }

        vmEvaluator = vmContext.getContract();
        if (vmEvaluator === null) {
            throw new Error('Contract not found.');
        }

        await vmEvaluator.setupContract(ANY_OWNER, ANY_CONTRACT_ADDRESS);

        decodedViewSelectors = vmEvaluator.getViewSelectors();
        decodedMethodSelectors = vmEvaluator.getMethodSelectors();

        expect(decodedViewSelectors.has(ANY_CONTRACT_ADDRESS)).toBeTruthy();
        expect(decodedMethodSelectors.has(ANY_CONTRACT_ADDRESS)).toBeTruthy();

        mainContractViewSelectors = decodedViewSelectors.get(ANY_CONTRACT_ADDRESS);
        mainContractMethodSelectors = decodedMethodSelectors.get(ANY_CONTRACT_ADDRESS);

        if (!vmEvaluator) {
            throw new Error('VM runtime not found.');
        }

        const isInitialized = vmEvaluator.isInitialized();
        expect(isInitialized).toBeTruthy();
    }

    async function getBalanceOf(address: string): Promise<bigint> {
        if (!vmEvaluator) {
            throw new Error('VM runtime not found.');
        }

        if (!mainContractMethodSelectors) {
            throw new Error('Method not found');
        }

        const balanceOfSelector = Number(`0x` + abiCoder.encodeSelector('balanceOf'));
        const hasTotalSupply = mainContractMethodSelectors.has(balanceOfSelector);
        if (!hasTotalSupply) {
            throw new Error('balanceOf selector not found');
        }

        const calldata: BinaryWriter = new BinaryWriter();
        //calldata.writeSelector(balanceOfSelector);
        calldata.writeAddress(address);

        const buffer = calldata.getBuffer();
        console.log(
            'calldata getBalanceOf ->',
            balanceOfSelector,
            Buffer.from(buffer).toString('hex'),
        );

        const balanceValue = await vmEvaluator
            .execute(ANY_CONTRACT_ADDRESS, true, balanceOfSelector, buffer)
            .catch((e) => {
                expect(e).toBeUndefined();

                vmManager.revertBlock();
            });

        if (balanceValue === undefined || balanceValue.result === undefined) {
            throw new Error('Balance value not found');
        }

        vmManager.updateBlockValuesFromResult(balanceValue, ANY_CONTRACT_ADDRESS, false);

        const decodedResponse = abiCoder.decodeData(balanceValue.result, [
            ABIDataTypes.UINT256,
        ]) as [bigint];

        return decodedResponse[0];
    }

    async function giveMoneyTo(
        address: string,
        amount: bigint,
        verify: boolean = false,
    ): Promise<[bigint, bigint]> {
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

        const balanceOfUserBeforeAddition = await getBalanceOf(address);

        const addBalanceSelector = Number(`0x` + abiCoder.encodeSelector('addFreeMoney'));
        const addCalldata: BinaryWriter = new BinaryWriter();

        //addCalldata.writeSelector(addBalanceSelector);
        addCalldata.writeAddress(address);
        addCalldata.writeU256(amount);

        const addBuffer = addCalldata.getBuffer();
        console.log(
            'calldata giveMoneyTo ->',
            addBalanceSelector,
            Buffer.from(addBuffer).toString('hex'),
        );

        const result = await vmEvaluator
            .execute(ANY_CONTRACT_ADDRESS, false, addBalanceSelector, addBuffer, address)
            .catch((e) => {
                expect(e).toBeUndefined();

                vmManager.revertBlock();
            });

        if (!result) throw new Error('Result not found');
        vmManager.updateBlockValuesFromResult(result, ANY_CONTRACT_ADDRESS, false);

        const balanceOfUserAfterAddition = await getBalanceOf(address);

        if (verify) {
            expect(balanceOfUserAfterAddition).toBe(balanceOfUserBeforeAddition + amount);
        }

        return [balanceOfUserBeforeAddition, balanceOfUserAfterAddition];
    }

    async function getTotalSupply(): Promise<bigint> {
        if (!vmEvaluator) {
            throw new Error('VM runtime not found.');
        }

        if (!mainContractViewSelectors) {
            throw new Error('Method not found');
        }

        const totalSupplySelector = Number(`0x` + abiCoder.encodeSelector('totalSupply'));

        const addCalldata: BinaryWriter = new BinaryWriter();
        //addCalldata.writeSelector(totalSupplySelector);
        console.log(
            totalSupplySelector,
            'calldata getTotalSupply ->',
            Buffer.from(addCalldata.getBuffer()).toString('hex'),
        );

        const totalSupplyValue = await vmEvaluator
            .execute(ANY_CONTRACT_ADDRESS, true, totalSupplySelector)
            .catch((e) => {
                expect(e).toBeUndefined();

                vmManager.revertBlock();
            });

        if (totalSupplyValue === undefined || totalSupplyValue.result === undefined) {
            throw new Error('Total supply value not found');
        }

        vmManager.updateBlockValuesFromResult(totalSupplyValue, ANY_CONTRACT_ADDRESS, false);

        const decodedResponse = abiCoder.decodeData(totalSupplyValue.result, [
            ABIDataTypes.UINT256,
        ]) as [bigint];

        return decodedResponse[0];
    }

    beforeAll(async () => {
        await vmManager.init();
        await vmManager.prepareBlock(RANDOM_BLOCK_ID);

        await load();
    });

    afterAll(async () => {
        if (vmManager) {
            await vmManager.updateEvaluatedStates();
            await vmManager.terminateBlock();
            await vmManager.closeDatabase();
        }
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
        if (!vmEvaluator) {
            throw new Error('VM evaluator not found.');
        }

        const isInitialized = vmEvaluator.isInitialized();
        expect(isInitialized).toBeTruthy();

        expect(mainContractViewSelectors).toBeDefined();
        expect(mainContractMethodSelectors).toBeDefined();

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

        const ownerValue = await vmEvaluator.execute(ANY_CONTRACT_ADDRESS, true, ownerSelector);
        if (!ownerValue || !ownerValue.result) {
            throw new Error('Owner value not found');
        }

        const decodedResponse = abiCoder.decodeData(ownerValue.result, [ABIDataTypes.ADDRESS]);
        expect(decodedResponse[0]).toBe(ANY_OWNER);
    });

    test(`BSC should create new memory slots when required and be able to run any given method by their method selector.`, async () => {
        expect(mainContractViewSelectors).toBeDefined();
        expect(mainContractMethodSelectors).toBeDefined();

        if (!vmEvaluator) {
            throw new Error('VM runtime not found.');
        }

        if (!mainContractViewSelectors) {
            throw new Error('ABI not found');
        }

        if (!module) {
            throw new Error('Module not found');
        }

        const balanceOfResponse = await getBalanceOf(ANY_OWNER);
        expect(balanceOfResponse).toBeGreaterThanOrEqual(0n);
    });

    test(`BSC should be able to compute basic operations such as additions and set the corresponding storage slot correctly.`, async () => {
        expect(mainContractViewSelectors).toBeDefined();
        expect(mainContractMethodSelectors).toBeDefined();

        let balanceOfUserBeforeAddition: bigint = 0n;

        let res: [bigint, bigint] | undefined;
        for (let i = 0n; i < EXECUTE_X_TIME; i++) {
            res = await giveMoneyTo(ANY_OWNER, BALANCE_TO_ADD);

            if (i === 0n) {
                balanceOfUserBeforeAddition = res[0];
            }
        }

        if (!res) {
            throw new Error('Balance not found');
        }

        const balanceOfUserAfterAddition = res[1];
        expect(balanceOfUserAfterAddition).toBe(
            balanceOfUserBeforeAddition + BALANCE_TO_ADD * EXECUTE_X_TIME,
        );
    });

    test(`A contract should be able to always read and write the correct memory slot values that are up to date. (Verify a multiple of arithmetic operations)`, async () => {
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

        const ANY_ADDRESS_A: string = '13sBQqJdnAdc7v5tnX3ifYqAMoFX79VfLc';
        const ANY_ADDRESS_B: string = '13sBQqJdnAdc7v5tnX3ifYqAMoFX79VfLb';

        const AMOUNT_TO_GIVE_TO_ADDRESS_A: bigint = 300000000000000000000000000000000000n;
        const AMOUNT_TO_GIVE_TO_ADDRESS_B: bigint = 100000000000000000000000000000000000n;

        const existingSupply = await getTotalSupply();

        const balanceOfAddressABefore = await getBalanceOf(ANY_ADDRESS_A);
        await giveMoneyTo(ANY_ADDRESS_A, AMOUNT_TO_GIVE_TO_ADDRESS_A, true);

        const balanceOfAddressBBefore = await getBalanceOf(ANY_ADDRESS_B);
        await giveMoneyTo(ANY_ADDRESS_B, AMOUNT_TO_GIVE_TO_ADDRESS_B, true);

        // Verify numerous arithmetic operations
        const testMethodMultipleAddressesSelector = Number(
            `0x` + abiCoder.encodeSelector('testMethodMultipleAddresses'),
        );

        // build calldata
        const addCalldata: BinaryWriter = new BinaryWriter();
        addCalldata.writeAddress(ANY_ADDRESS_A);
        addCalldata.writeAddress(ANY_ADDRESS_B);

        // get buffer
        const addBuffer = addCalldata.getBuffer();

        // execute
        const result = await vmEvaluator
            .execute(
                ANY_CONTRACT_ADDRESS,
                true,
                testMethodMultipleAddressesSelector,
                addBuffer,
                ANY_OWNER,
            )
            .catch((e) => {
                expect(e).toBeUndefined();

                vmManager.revertBlock();
            });

        if (!result || !result.result) {
            throw new Error('Result not found for testMethodMultipleAddresses');
        }

        const decodedResponse = abiCoder.decodeData(result.result, [ABIDataTypes.TUPLE]) as [
            [bigint, bigint, bigint, bigint, bigint],
        ];

        expect(decodedResponse.length).toBe(1);
        expect(decodedResponse[0].length).toBe(5);

        const [balanceOfAddressA, balanceOfAddressB, balanceAMinusBalanceB, balanceOfContract] =
            decodedResponse[0];

        const expectedTotalSupply =
            AMOUNT_TO_GIVE_TO_ADDRESS_A + AMOUNT_TO_GIVE_TO_ADDRESS_B + existingSupply;

        expect(balanceOfAddressA - balanceOfAddressABefore).toBe(AMOUNT_TO_GIVE_TO_ADDRESS_A);
        expect(balanceOfAddressB - balanceOfAddressBBefore).toBe(AMOUNT_TO_GIVE_TO_ADDRESS_B);

        expect(balanceAMinusBalanceB - (balanceOfAddressABefore - balanceOfAddressBBefore)).toBe(
            AMOUNT_TO_GIVE_TO_ADDRESS_A - AMOUNT_TO_GIVE_TO_ADDRESS_B,
        );

        expect(balanceOfContract).toBe(expectedTotalSupply);
    });
});
