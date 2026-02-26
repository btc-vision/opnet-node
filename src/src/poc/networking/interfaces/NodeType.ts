import { Libp2p } from 'libp2p';
import { UPnPNAT } from '@libp2p/upnp-nat';
import { KadDHT } from '@libp2p/kad-dht';
import { Identify, IdentifyPush } from '@libp2p/identify';
import { Ping } from '@libp2p/ping';
import { BootstrapComponents } from '@libp2p/bootstrap';
import { PeerDiscovery, PeerId } from '@libp2p/interface';
import { DisconnectionCode } from '../enums/DisconnectionCode.js';
import { Components } from 'libp2p/components.js';

export type BootstrapDiscoveryMethod = (components: BootstrapComponents) => PeerDiscovery;

export interface OPNetConnectionInfo {
    peerId: PeerId;
    agentVersion: string;
    protocolVersion: string;
}

export interface BlacklistedPeerInfo {
    reason: DisconnectionCode;
    timestamp: number;
    attempts: number;
}

export type P2PServices = {
    nat?: UPnPNAT;
    autoNAT?: unknown;
    aminoDHT: KadDHT;
    identify: Identify;
    identifyPush: IdentifyPush;
    ping: Ping;
};

export type Libp2pInstance = Libp2p<P2PServices> & {
    components: Components & P2PServices;
};
