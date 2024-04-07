import { BitcoinCore } from './BitcoinCore.js';

export class MineBlock extends BitcoinCore {
    constructor() {
        super();
    }

    protected async mineBlock(blockCount: number): Promise<void> {
        if (!this.walletAddress) throw new Error('Wallet address not set');

        const blocks = await this.bitcoinRPC.generateToAddress(
            blockCount,
            this.walletAddress,
            this.defaultWalletName,
        );

        if (!blocks) {
            throw new Error('Failed to mine block');
        }

        this.log(`Mined ${blocks.length} blocks`);
    }

    public async init(): Promise<void> {
        await super.init();

        await this.mineBlock(1);
    }
}

void new MineBlock().init();
