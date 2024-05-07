/** Reserved from 0x00 to 0xB */
export enum CommonPackets {
    PONG = 0x00,
}

/** From 0x0C to 0x7A */
export enum ServerInBound {
    PING = 0x0c,
    AUTHENTICATION = 0x0d,
    CLIENT_CIPHER_EXCHANGE = 0x0e,
}

/** from 0x80 to 0xFF */
export enum ServerOutBound {
    AUTHENTICATION_STATUS = 0x80,
    SERVER_CIPHER_EXCHANGE = 0x81,
}

export type PossiblePackets = CommonPackets | ServerInBound | ServerOutBound;
