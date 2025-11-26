/**
 * WebSocket API Request Opcodes
 * Range: 0x00 - 0x7F for client requests
 */
export enum WebSocketRequestOpcode {
    // Connection Management (0x00 - 0x0F)
    PING = 0x00,
    HANDSHAKE = 0x01,

    // Block Methods (0x10 - 0x1F)
    GET_BLOCK_NUMBER = 0x10,
    GET_BLOCK_BY_NUMBER = 0x11,
    GET_BLOCK_BY_HASH = 0x12,
    GET_BLOCK_BY_CHECKSUM = 0x13,
    GET_BLOCK_WITNESS = 0x14,
    GET_GAS = 0x15,

    // Transaction Methods (0x20 - 0x2F)
    GET_TRANSACTION_BY_HASH = 0x20,
    GET_TRANSACTION_RECEIPT = 0x21,
    BROADCAST_TRANSACTION = 0x22,
    GET_PREIMAGE = 0x23,

    // Address Methods (0x30 - 0x3F)
    GET_BALANCE = 0x30,
    GET_UTXOS = 0x31,
    GET_PUBLIC_KEY_INFO = 0x32,

    // Chain Methods (0x40 - 0x4F)
    GET_CHAIN_ID = 0x40,
    GET_REORG = 0x41,

    // State Methods (0x50 - 0x5F)
    GET_CODE = 0x50,
    GET_STORAGE_AT = 0x51,
    CALL = 0x52,

    // Epoch Methods (0x60 - 0x6F)
    GET_LATEST_EPOCH = 0x60,
    GET_EPOCH_BY_NUMBER = 0x61,
    GET_EPOCH_BY_HASH = 0x62,
    GET_EPOCH_TEMPLATE = 0x63,
    SUBMIT_EPOCH = 0x64,

    // Subscription Methods (0x70 - 0x7F)
    SUBSCRIBE_BLOCKS = 0x70,
    SUBSCRIBE_EPOCHS = 0x71,
    UNSUBSCRIBE = 0x7f,
}

/**
 * WebSocket API Response Opcodes
 * Range: 0x80 - 0xFF for server responses
 */
export enum WebSocketResponseOpcode {
    // Error Response
    ERROR = 0x80,

    // Connection Management Responses (0x81 - 0x8F)
    PONG = 0x81,
    HANDSHAKE_ACK = 0x82,

    // Block Method Responses (0x90 - 0x9F)
    BLOCK_NUMBER = 0x90,
    BLOCK = 0x91,
    BLOCK_WITNESS = 0x92,
    GAS = 0x93,

    // Transaction Method Responses (0xA0 - 0xAF)
    TRANSACTION = 0xa0,
    TRANSACTION_RECEIPT = 0xa1,
    BROADCAST_RESULT = 0xa2,
    PREIMAGE = 0xa3,

    // Address Method Responses (0xB0 - 0xBF)
    BALANCE = 0xb0,
    UTXOS = 0xb1,
    PUBLIC_KEY_INFO = 0xb2,

    // Chain Method Responses (0xC0 - 0xCF)
    CHAIN_ID = 0xc0,
    REORG = 0xc1,

    // State Method Responses (0xD0 - 0xDF)
    CODE = 0xd0,
    STORAGE = 0xd1,
    CALL_RESULT = 0xd2,

    // Epoch Method Responses (0xE0 - 0xEF)
    EPOCH = 0xe0,
    EPOCH_TEMPLATE = 0xe1,
    EPOCH_SUBMIT_RESULT = 0xe2,

    // Subscription Responses (0xF0 - 0xFF)
    SUBSCRIPTION_CREATED = 0xf0,
    UNSUBSCRIBE_RESULT = 0xf1,

    // Server Push Notifications
    NEW_BLOCK_NOTIFICATION = 0xf8,
    NEW_EPOCH_NOTIFICATION = 0xf9,
}

/**
 * Union type for all possible opcodes
 */
export type WebSocketOpcode = WebSocketRequestOpcode | WebSocketResponseOpcode;

/**
 * Maps request opcodes to their corresponding response opcodes
 */
export const RequestToResponseOpcode: Readonly<
    Record<WebSocketRequestOpcode, WebSocketResponseOpcode>
> = {
    [WebSocketRequestOpcode.PING]: WebSocketResponseOpcode.PONG,
    [WebSocketRequestOpcode.HANDSHAKE]: WebSocketResponseOpcode.HANDSHAKE_ACK,

    [WebSocketRequestOpcode.GET_BLOCK_NUMBER]: WebSocketResponseOpcode.BLOCK_NUMBER,
    [WebSocketRequestOpcode.GET_BLOCK_BY_NUMBER]: WebSocketResponseOpcode.BLOCK,
    [WebSocketRequestOpcode.GET_BLOCK_BY_HASH]: WebSocketResponseOpcode.BLOCK,
    [WebSocketRequestOpcode.GET_BLOCK_BY_CHECKSUM]: WebSocketResponseOpcode.BLOCK,
    [WebSocketRequestOpcode.GET_BLOCK_WITNESS]: WebSocketResponseOpcode.BLOCK_WITNESS,
    [WebSocketRequestOpcode.GET_GAS]: WebSocketResponseOpcode.GAS,

    [WebSocketRequestOpcode.GET_TRANSACTION_BY_HASH]: WebSocketResponseOpcode.TRANSACTION,
    [WebSocketRequestOpcode.GET_TRANSACTION_RECEIPT]: WebSocketResponseOpcode.TRANSACTION_RECEIPT,
    [WebSocketRequestOpcode.BROADCAST_TRANSACTION]: WebSocketResponseOpcode.BROADCAST_RESULT,
    [WebSocketRequestOpcode.GET_PREIMAGE]: WebSocketResponseOpcode.PREIMAGE,

    [WebSocketRequestOpcode.GET_BALANCE]: WebSocketResponseOpcode.BALANCE,
    [WebSocketRequestOpcode.GET_UTXOS]: WebSocketResponseOpcode.UTXOS,
    [WebSocketRequestOpcode.GET_PUBLIC_KEY_INFO]: WebSocketResponseOpcode.PUBLIC_KEY_INFO,

    [WebSocketRequestOpcode.GET_CHAIN_ID]: WebSocketResponseOpcode.CHAIN_ID,
    [WebSocketRequestOpcode.GET_REORG]: WebSocketResponseOpcode.REORG,

    [WebSocketRequestOpcode.GET_CODE]: WebSocketResponseOpcode.CODE,
    [WebSocketRequestOpcode.GET_STORAGE_AT]: WebSocketResponseOpcode.STORAGE,
    [WebSocketRequestOpcode.CALL]: WebSocketResponseOpcode.CALL_RESULT,

    [WebSocketRequestOpcode.GET_LATEST_EPOCH]: WebSocketResponseOpcode.EPOCH,
    [WebSocketRequestOpcode.GET_EPOCH_BY_NUMBER]: WebSocketResponseOpcode.EPOCH,
    [WebSocketRequestOpcode.GET_EPOCH_BY_HASH]: WebSocketResponseOpcode.EPOCH,
    [WebSocketRequestOpcode.GET_EPOCH_TEMPLATE]: WebSocketResponseOpcode.EPOCH_TEMPLATE,
    [WebSocketRequestOpcode.SUBMIT_EPOCH]: WebSocketResponseOpcode.EPOCH_SUBMIT_RESULT,

    [WebSocketRequestOpcode.SUBSCRIBE_BLOCKS]: WebSocketResponseOpcode.SUBSCRIPTION_CREATED,
    [WebSocketRequestOpcode.SUBSCRIBE_EPOCHS]: WebSocketResponseOpcode.SUBSCRIPTION_CREATED,
    [WebSocketRequestOpcode.UNSUBSCRIBE]: WebSocketResponseOpcode.UNSUBSCRIBE_RESULT,
};

/**
 * Human-readable names for opcodes (for logging)
 */
export const OpcodeNames: Readonly<Record<WebSocketOpcode, string>> = {
    // Request opcodes
    [WebSocketRequestOpcode.PING]: 'PING',
    [WebSocketRequestOpcode.HANDSHAKE]: 'HANDSHAKE',
    [WebSocketRequestOpcode.GET_BLOCK_NUMBER]: 'GET_BLOCK_NUMBER',
    [WebSocketRequestOpcode.GET_BLOCK_BY_NUMBER]: 'GET_BLOCK_BY_NUMBER',
    [WebSocketRequestOpcode.GET_BLOCK_BY_HASH]: 'GET_BLOCK_BY_HASH',
    [WebSocketRequestOpcode.GET_BLOCK_BY_CHECKSUM]: 'GET_BLOCK_BY_CHECKSUM',
    [WebSocketRequestOpcode.GET_BLOCK_WITNESS]: 'GET_BLOCK_WITNESS',
    [WebSocketRequestOpcode.GET_GAS]: 'GET_GAS',
    [WebSocketRequestOpcode.GET_TRANSACTION_BY_HASH]: 'GET_TRANSACTION_BY_HASH',
    [WebSocketRequestOpcode.GET_TRANSACTION_RECEIPT]: 'GET_TRANSACTION_RECEIPT',
    [WebSocketRequestOpcode.BROADCAST_TRANSACTION]: 'BROADCAST_TRANSACTION',
    [WebSocketRequestOpcode.GET_PREIMAGE]: 'GET_PREIMAGE',
    [WebSocketRequestOpcode.GET_BALANCE]: 'GET_BALANCE',
    [WebSocketRequestOpcode.GET_UTXOS]: 'GET_UTXOS',
    [WebSocketRequestOpcode.GET_PUBLIC_KEY_INFO]: 'GET_PUBLIC_KEY_INFO',
    [WebSocketRequestOpcode.GET_CHAIN_ID]: 'GET_CHAIN_ID',
    [WebSocketRequestOpcode.GET_REORG]: 'GET_REORG',
    [WebSocketRequestOpcode.GET_CODE]: 'GET_CODE',
    [WebSocketRequestOpcode.GET_STORAGE_AT]: 'GET_STORAGE_AT',
    [WebSocketRequestOpcode.CALL]: 'CALL',
    [WebSocketRequestOpcode.GET_LATEST_EPOCH]: 'GET_LATEST_EPOCH',
    [WebSocketRequestOpcode.GET_EPOCH_BY_NUMBER]: 'GET_EPOCH_BY_NUMBER',
    [WebSocketRequestOpcode.GET_EPOCH_BY_HASH]: 'GET_EPOCH_BY_HASH',
    [WebSocketRequestOpcode.GET_EPOCH_TEMPLATE]: 'GET_EPOCH_TEMPLATE',
    [WebSocketRequestOpcode.SUBMIT_EPOCH]: 'SUBMIT_EPOCH',
    [WebSocketRequestOpcode.SUBSCRIBE_BLOCKS]: 'SUBSCRIBE_BLOCKS',
    [WebSocketRequestOpcode.SUBSCRIBE_EPOCHS]: 'SUBSCRIBE_EPOCHS',
    [WebSocketRequestOpcode.UNSUBSCRIBE]: 'UNSUBSCRIBE',

    // Response opcodes
    [WebSocketResponseOpcode.ERROR]: 'ERROR',
    [WebSocketResponseOpcode.PONG]: 'PONG',
    [WebSocketResponseOpcode.HANDSHAKE_ACK]: 'HANDSHAKE_ACK',
    [WebSocketResponseOpcode.BLOCK_NUMBER]: 'BLOCK_NUMBER',
    [WebSocketResponseOpcode.BLOCK]: 'BLOCK',
    [WebSocketResponseOpcode.BLOCK_WITNESS]: 'BLOCK_WITNESS',
    [WebSocketResponseOpcode.GAS]: 'GAS',
    [WebSocketResponseOpcode.TRANSACTION]: 'TRANSACTION',
    [WebSocketResponseOpcode.TRANSACTION_RECEIPT]: 'TRANSACTION_RECEIPT',
    [WebSocketResponseOpcode.BROADCAST_RESULT]: 'BROADCAST_RESULT',
    [WebSocketResponseOpcode.PREIMAGE]: 'PREIMAGE',
    [WebSocketResponseOpcode.BALANCE]: 'BALANCE',
    [WebSocketResponseOpcode.UTXOS]: 'UTXOS',
    [WebSocketResponseOpcode.PUBLIC_KEY_INFO]: 'PUBLIC_KEY_INFO',
    [WebSocketResponseOpcode.CHAIN_ID]: 'CHAIN_ID',
    [WebSocketResponseOpcode.REORG]: 'REORG',
    [WebSocketResponseOpcode.CODE]: 'CODE',
    [WebSocketResponseOpcode.STORAGE]: 'STORAGE',
    [WebSocketResponseOpcode.CALL_RESULT]: 'CALL_RESULT',
    [WebSocketResponseOpcode.EPOCH]: 'EPOCH',
    [WebSocketResponseOpcode.EPOCH_TEMPLATE]: 'EPOCH_TEMPLATE',
    [WebSocketResponseOpcode.EPOCH_SUBMIT_RESULT]: 'EPOCH_SUBMIT_RESULT',
    [WebSocketResponseOpcode.SUBSCRIPTION_CREATED]: 'SUBSCRIPTION_CREATED',
    [WebSocketResponseOpcode.UNSUBSCRIBE_RESULT]: 'UNSUBSCRIBE_RESULT',
    [WebSocketResponseOpcode.NEW_BLOCK_NOTIFICATION]: 'NEW_BLOCK_NOTIFICATION',
    [WebSocketResponseOpcode.NEW_EPOCH_NOTIFICATION]: 'NEW_EPOCH_NOTIFICATION',
};
