import { Command } from './Command.js';
import { Commands } from '../types/PossibleCommands.js';
import { Channel } from 'ssh2';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { OPNetPeerInfo } from '../../../poa/networking/protobuf/packets/peering/DiscoveryResponsePacket.js';
import { ChainIds } from '../../../config/enums/ChainIds.js';

export class PeerInfoCommand extends Command<Commands.PEER_INFO> {
    public readonly command: Commands.PEER_INFO = Commands.PEER_INFO;

    public async execute(cli: Channel, _args: string[]): Promise<void> {
        const msg = this.buildMsgToP2PManager();

        const peersInfo = (await this.sendMessageToThread(ThreadTypes.P2P, msg)) as {
            peers: OPNetPeerInfo[];
        };

        const message = this.createPeerInfoMessage(peersInfo.peers);
        cli.write(message + '\r\n');
    }

    private createPeerInfoMessage(peers: OPNetPeerInfo[]): string {
        if (peers.length === 0) {
            return this.chalk.hex('#FFDD57').bold('⚠️ No peers found.');
        }

        // Header
        const header = this.chalk.hex('#00D1B2').bold.underline('📡 Peer Information');
        const totalPeers = this.chalk.hex('#FF69B4').bold(`Total Peers: ${peers.length}`);

        // Peer details
        const peerDetails = peers
            .map((peer, index) => {
                return [
                    this.chalk.hex('#00CFFD').bold(`Peer ${index + 1}:`),
                    this.chalk.hex('#FF6F61')(`  - OPNet Version: `) +
                        this.chalk.hex('#FAD02E').bold(peer.opnetVersion),
                    this.chalk.hex('#FF6F61')(`  - Identity: `) +
                        this.chalk.hex('#B39CD0').bold(peer.identity),
                    this.chalk.hex('#FF6F61')(`  - Type: `) +
                        this.chalk.hex('#FF9F29').bold(peer.type.toString()),
                    this.chalk.hex('#FF6F61')(`  - Network: `) +
                        this.chalk.hex('#29FFB1').bold(peer.network.toString()),
                    this.chalk.hex('#FF6F61')(`  - Chain ID: `) +
                        this.chalk.hex('#A1C6E7').bold(ChainIds[peer.chainId] ?? 'Unknown'),
                    this.chalk.hex('#FF6F61')(`  - Peer: `) +
                        this.chalk.hex('#D0A6F9').bold(peer.peer.toString()),
                    this.chalk.hex('#FF6F61')(`  - Addresses: `) +
                        peer.addresses
                            .map((address) => this.chalk.hex('#FA8072')(address.toString()))
                            .join(this.chalk.hex('#FF69B4')(', ')),
                ].join('\n');
            })
            .join('\n\n');

        return [header, totalPeers, ' ', peerDetails].join('\n\n');
    }

    private buildMsgToP2PManager(): ThreadMessageBase<MessageType.GET_PEERS> {
        return {
            type: MessageType.GET_PEERS,
            data: {},
        };
    }
}
