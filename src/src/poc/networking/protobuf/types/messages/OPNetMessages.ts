/** Reserved from 0x00 to 0xB */
export enum CommonPackets {
    PONG = 0x00,

    /** Blockchain */
    BLOCK_HEADER_WITNESS = 0x0b,

    /** Transactions */
    BROADCAST_TRANSACTION = 0x0f,
}

/** From 0x0C to 0x7A */
export enum ServerInBound {
    PING = 0x0c,
    AUTHENTICATION = 0x0d,
    CLIENT_CIPHER_EXCHANGE = 0x0e,

    /** Peering */
    DISCOVER = 0x82,

    /** SYNC */
    SYNC_BLOCK_HEADERS_REQUEST = 0x7a,
}

/** from 0x80 to 0xFF */
export enum ServerOutBound {
    AUTHENTICATION_STATUS = 0x80,
    SERVER_CIPHER_EXCHANGE = 0x81,

    /** Peering */
    DISCOVERY_RESPONSE = 0x83,

    /** SYNC */
    SYNC_BLOCK_HEADERS_RESPONSE = 0x10,
}

export type PossiblePackets = CommonPackets | ServerInBound | ServerOutBound;
