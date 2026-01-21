import { OPNetConsensus } from '../../../poc/configurations/OPNetConsensus.js';
import { Logger } from '@btc-vision/bsi-common';
import figlet, { FontName } from 'figlet';

export class ConsensusTracker extends Logger {
    public readonly logColor: string = '#ff9100';

    constructor() {
        super();

        this.addConsensusListeners();
    }

    public setConsensusBlockHeight(blockHeight: bigint): boolean {
        try {
            if (this.verifyConsensus(blockHeight)) {
                return true;
            }

            OPNetConsensus.setBlockHeight(blockHeight);

            if (this.verifyConsensus(blockHeight)) {
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
        } catch {
            return true;
        }
    }

    public onConsensusFailed(consensusName: string): void {
        this.notifyArt(
            'warn',
            `FATAL.`,
            'Doh',
            `\n\n\n!!!!!!!!!! -------------------- UPGRADE FAILED. --------------------  !!!!!!!!!!\n\n\n\n\n`,
            `\n\nPoC has been disabled. This node will not connect to any peers. And any processing will be halted.\n`,
            `This node is not ready to apply ${consensusName}.\n`,
            `UPGRADE IMMEDIATELY.\n\n`,
        );

        setTimeout(() => {
            process.exit(1); // Exit the process.
        }, 2000);
    }

    private verifyConsensus(blockHeight: bigint): boolean {
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

        return false;
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
        font: FontName,
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
