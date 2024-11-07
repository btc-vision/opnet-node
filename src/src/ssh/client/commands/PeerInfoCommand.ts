import { Command } from './Command.js';
import { Commands } from '../types/PossibleCommands.js';
import { Channel } from 'ssh2';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { OPNetPeerInfo } from '../../../poa/networking/protobuf/packets/peering/DiscoveryResponsePacket.js';
import { ChainIds } from '../../../config/enums/ChainIds.js';
import { peerIdFromCID } from '@libp2p/peer-id';
import { CID } from 'multiformats/cid';
import { multiaddr, Multiaddr } from '@multiformats/multiaddr';
import { OPNetIndexerMode } from '../../../config/interfaces/OPNetIndexerMode.js';
import { NetworkConverter } from '../../../config/network/NetworkConverter.js';

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
            return this.chalk.hex('#FFDD57').bold('⚠️ No peers found.\r\n');
        }

        // Header
        const header = this.chalk.hex('#00D1B2').bold.underline('📡 Peers Information');
        const totalPeers = this.chalk.hex('#FF69B4').bold(`Total Connected Peers: ${peers.length}`);

        // Peer details
        const peerDetails = peers
            .map((peer, index) => {
                const peerId = peerIdFromCID(CID.decode(peer.peer));
                const peerStr = peerId.toString();

                const addresses: Multiaddr[] = [];
                for (const address of peer.addresses) {
                    const addr = multiaddr(address);

                    if (addr && addr.toString().includes(peerStr)) {
                        addresses.push(addr);
                    }
                }

                const addressesDisplay =
                    addresses.length > 0
                        ? addresses
                              .map((addr) =>
                                  this.chalk.hex('#FA8072')(`      - ${addr.toString()}\r\n`),
                              )
                              .join('')
                        : this.chalk.hex('#FF6F61')('      - No valid addresses\r\n');

                const indexerMode = this.getIndexerMode(peer.type);
                const peerNetwork = NetworkConverter.numberToBitcoinNetwork(peer.network);

                return [
                    this.chalk.hex('#00CFFD').bold(`Peer ${peerStr} (${index + 1}):\r\n`),
                    this.chalk.hex('#FF6F61')(`  - OPNet Version: `) +
                        this.chalk.hex('#FAD02E').bold(peer.opnetVersion) +
                        '\r\n',
                    this.chalk.hex('#FF6F61')(`  - Chain: `) +
                        this.chalk.hex('#A1C6E7').bold(ChainIds[peer.chainId] ?? 'Unknown') +
                        '\r\n',
                    this.chalk.hex('#FF6F61')(`  - Network: `) +
                        this.chalk.hex('#29FFB1').bold(peerNetwork) +
                        '\r\n',
                    this.chalk.hex('#FF6F61')(`  - Mode: `) +
                        this.chalk.hex('#FF9F29').bold(indexerMode) +
                        '\r\n',
                    this.chalk.hex('#FF6F61')(`  - Identity: `) +
                        this.chalk.hex('#B39CD0').bold(peer.identity) +
                        '\r\n',
                    this.chalk.hex('#FF6F61')(`  - Address(es):\r\n`) + addressesDisplay,
                ].join('');
            })
            .join('\r\n\r\n');

        return [header, totalPeers, '\r\n', peerDetails].join('\r\n');
    }

    private getIndexerMode(type: number): OPNetIndexerMode | 'Unknown' {
        switch (type) {
            case 0: {
                return OPNetIndexerMode.ARCHIVE;
            }
            case 1: {
                return OPNetIndexerMode.FULL;
            }
            case 2: {
                return OPNetIndexerMode.LIGHT;
            }
            default: {
                return 'Unknown';
            }
        }
    }

    private buildMsgToP2PManager(): ThreadMessageBase<MessageType.GET_PEERS> {
        return {
            type: MessageType.GET_PEERS,
            data: {},
        };
    }
}
