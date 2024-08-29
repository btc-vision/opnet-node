import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { Logger } from '@btc-vision/bsi-common';
import figlet, { Fonts } from 'figlet';

export class ConsensusTracker extends Logger {
    public readonly logColor: string = '#ff9100';

    constructor() {
        super();

        this.addConsensusListeners();
    }

    public setConsensusBlockHeight(blockHeight: bigint): boolean {
        try {
            if (
                OPNetConsensus.hasConsensus() &&
                OPNetConsensus.isConsensusBlock() &&
                !OPNetConsensus.isReadyForNextConsensus()
            ) {
                this.panic(
                    `Consensus is getting applied in this block (${blockHeight}) but the node is not ready for the next consensus. UPDATE YOUR NODE!`,
                );
                return true;
            }

            OPNetConsensus.setBlockHeight(blockHeight);

            if (
                OPNetConsensus.hasConsensus() &&
                OPNetConsensus.isConsensusBlock() &&
                !OPNetConsensus.isReadyForNextConsensus()
            ) {
                this.panic(
                    `Consensus is getting applied in this block (${blockHeight}) but the node is not ready for the next consensus. UPDATE YOUR NODE!`,
                );
                return true;
            }

            if (
                OPNetConsensus.isNextConsensusImminent() &&
                !OPNetConsensus.isReadyForNextConsensus()
            ) {
                this.warn(
                    `!!! --- Next consensus is imminent. Please prepare for the next consensus by upgrading your node. The next consensus will take effect in ${OPNetConsensus.consensus.GENERIC.NEXT_CONSENSUS_BLOCK - blockHeight} blocks. --- !!!`,
                );
            }

            return false;
        } catch (e) {
            return true;
        }
    }

    public async lockdown(): Promise<void> {
        this.notifyArt(
            'panic',
            `LOCKDOWN`,
            'Doh',
            `\n\n\nOP_NET detected a compromised block.\n\n\n\n\n`,
            `\n\nA vault has been compromised. The network is now in lockdown.\n`,
        );

        this.panic(`A vault has been compromised. The network is now in lockdown.`);
        this.panic(`If this is a false positive, this should be resolved automatically.`);
        this.panic(`To prevent further damage, the network has been locked down.`);
    }

    public onConsensusFailed(consensusName: string): void {
        this.notifyArt(
            'warn',
            `FATAL.`,
            'Doh',
            `\n\n\n!!!!!!!!!! -------------------- UPGRADE FAILED. --------------------  !!!!!!!!!!\n\n\n\n\n`,
            `\n\nPoA has been disabled. This node will not connect to any peers. And any processing will be halted.\n`,
            `This node is not ready to apply ${consensusName}.\n`,
            `UPGRADE IMMEDIATELY.\n\n`,
        );

        setTimeout(() => {
            process.exit(1); // Exit the process.
        }, 2000);
    }

    private addConsensusListeners(): void {
        OPNetConsensus.addConsensusUpgradeCallback((consensus: string, isReady: boolean) => {
            if (!isReady) {
                this.panic(`Consensus upgrade to ${consensus} failed.`);
            }
        });
    }

    private notifyArt(
        type: 'info' | 'warn' | 'success' | 'panic',
        text: string,
        font: Fonts,
        prefix: string,
        ...suffix: string[]
    ): void {
        const artVal = figlet.textSync(text, {
            font: font, //'Doh',
            horizontalLayout: 'default',
            verticalLayout: 'default',
        });

        this[type](`${prefix}${artVal}${suffix.join('\n')}`);
    }
}
