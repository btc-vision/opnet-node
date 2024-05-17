export enum Packets {
    /** Authentication */
    Authentication = 'Authentication',
    ClientKeyCipherExchange = 'ClientKeyCipherExchange',
    ServerKeyCipherExchange = 'ServerKeyCipherExchange',
    AuthenticationStatus = 'AuthenticationStatus',

    /** General */
    Ping = 'Ping',
    Pong = 'Pong',

    /** Peering */
    Discover = 'Discover',
    DiscoveryResponse = 'DiscoveryResponse',

    /** Blockchain */
    BlockHeaderWitness = 'BlockHeaderWitness',
    Transaction = 'Transaction',

    /** Sync */
    SyncBlockHeadersRequest = 'SyncBlockHeadersRequest',
    SyncBlockHeadersResponse = 'SyncBlockHeadersResponse',
}
