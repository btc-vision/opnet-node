import { Logger } from '@btc-vision/motoswapcommon';
import fs from 'fs';
import assert from 'node:assert';
import { BitcoinHelper } from '../../bitcoin/BitcoinHelper.js';
import { ABICoder, ABIDataTypes } from '../abi/ABICoder.js';
import { ContractABIMap, MethodMap, PropertyABIMap, SelectorsMap } from '../buffer/types/math.js';
import { VMContext } from '../evaluated/EvaluatedContext.js';
import { ContractEvaluator } from '../runtime/ContractEvaluator.js';
import { VMManager } from '../VMManager.js';
import { VMRuntime } from '../wasmRuntime/runDebug.js';

export class VMTester extends Logger {
    public readonly logColor: string = '#00d0ff';

    private CONTRACT_ADDRESS: string =
        'bc1p3hnqcq7jq6k30ryv8lfzx3ruuvkwr7gu50xz4acweqv4a7sj44cq9jhmq5';

    private DEPLOYER_ADDRESS = BitcoinHelper.generateWallet();
    private RANDOM_BLOCK_ID: bigint = 1073478347n;

    private abiCoder: ABICoder = new ABICoder();

    private OWNER: string = this.DEPLOYER_ADDRESS.address;

    private decodedViewSelectors: SelectorsMap = new Map();
    private decodedMethodSelectors: MethodMap = new Map();

    private mainContractViewSelectors: PropertyABIMap | undefined;
    private mainContractMethodSelectors: ContractABIMap | undefined;

    private vmEvaluator: ContractEvaluator | null = null;
    private vmContext: VMContext | null = null;
    private vmRuntime: VMRuntime | null = null;

    private loaded: Promise<void> | null = null;

    constructor(private vmManager: VMManager) {
        super();

        void this.test();
    }

    private async test(): Promise<void> {
        await this.load();
        await this.testSelectors();
        await this.testCall();
    }

    private async load(): Promise<void> {
        this.log(`Loading VM...`);

        this.loaded = new Promise<void>(async (resolve) => {
            await this.vmManager.init();
            await this.vmManager.prepareBlock(this.RANDOM_BLOCK_ID);

            const contractBytecode: Buffer = fs.readFileSync('../bytecode/contract.wasm');
            assert(contractBytecode !== undefined);

            this.vmContext = await this.vmManager.loadContractFromBytecode(contractBytecode);
            assert(this.vmContext !== undefined);

            if (this.vmContext.contract === null) {
                throw new Error('Contract not found.');
            }

            this.vmEvaluator = this.vmContext.contract;
            //this.vmRuntime = this.vmEvaluator.wasm;

            let REAL_CONTRACT_ADDRESS = BitcoinHelper.generateNewContractAddress(
                contractBytecode,
                this.DEPLOYER_ADDRESS.publicKey,
            );

            if (!this.CONTRACT_ADDRESS) {
                this.CONTRACT_ADDRESS = REAL_CONTRACT_ADDRESS;
            }

            console.log(
                `Bitcoin Smart Contract will be deployed at: ${this.CONTRACT_ADDRESS} by ${this.OWNER}`,
            );

            await this.vmEvaluator.setupContract(this.OWNER, this.CONTRACT_ADDRESS);
            console.log('Contract deployed.');

            this.decodedViewSelectors = this.vmEvaluator.getViewSelectors();
            this.decodedMethodSelectors = this.vmEvaluator.getMethodSelectors();

            console.log('ABI ->', this.decodedViewSelectors, this.decodedMethodSelectors);

            assert(this.decodedViewSelectors.has(this.CONTRACT_ADDRESS) === true);
            assert(this.decodedMethodSelectors.has(this.CONTRACT_ADDRESS) === true);

            this.mainContractViewSelectors = this.decodedViewSelectors.get(this.CONTRACT_ADDRESS);
            this.mainContractMethodSelectors = this.decodedMethodSelectors.get(
                this.CONTRACT_ADDRESS,
            );

            const isInitialized = this.vmEvaluator.isInitialized();
            assert(isInitialized === true);

            resolve();
        });

        return await this.loaded;
    }

    private async testSelectors(): Promise<void> {
        assert(this.vmContext !== null);
        assert(this.decodedViewSelectors !== null);
        assert(this.decodedMethodSelectors !== null);

        if (!this.mainContractMethodSelectors) {
            throw new Error('Method not found');
        }

        if (!this.mainContractViewSelectors) {
            throw new Error('ABI not found');
        }

        if (!this.vmContext) {
            throw new Error('Module not found');
        }

        const ownerSelector = this.mainContractViewSelectors.get('owner');
        if (!ownerSelector) {
            throw new Error('Owner selector not found');
        }

        this.log('Owner selector:', ownerSelector);
    }

    private async testCall(): Promise<void> {
        if (!this.vmEvaluator) {
            throw new Error('VM evaluator not found.');
        }

        const isInitialized = this.vmEvaluator.isInitialized();
        assert(isInitialized === true);

        assert(this.mainContractViewSelectors !== null);
        assert(this.mainContractMethodSelectors !== null);

        if (!this.mainContractMethodSelectors) {
            throw new Error('Method not found');
        }

        if (!this.mainContractViewSelectors) {
            throw new Error('ABI not found');
        }

        if (!this.vmEvaluator) {
            throw new Error('VM evaluator not found.');
        }

        const ownerSelector = this.mainContractViewSelectors.get('owner');
        if (!ownerSelector) {
            throw new Error('Owner selector not found');
        }
        
        const ownerValue = await this.vmEvaluator.execute(true, ownerSelector);
        if (!ownerValue) {
            throw new Error('Owner value not found');
        }

        const decodedResponse = this.abiCoder.decodeData(ownerValue, [ABIDataTypes.ADDRESS]);

        assert(decodedResponse[0] === this.OWNER);
    }
}
