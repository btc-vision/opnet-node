export enum Routes {
    /** Block */
    LATEST_BLOCK = 'block/latest',

    BLOCK_BY_HASH = 'block/by-hash',
    BLOCK_BY_ID = 'block/by-id',

    /** OPNet */
    BLOCK_WITNESS = 'block/block-witness',

    /** Chain */
    CHAIN_ID = 'chain/id',
    REORG = 'chain/reorg',

    /** Address */
    UTXOS = 'address/utxos',
    GET_BALANCE = 'address/get-balance',

    /** Transaction */
    TRANSACTION_BY_HASH = 'transaction/by-hash',
    TRANSACTION_RECEIPT = 'transaction/receipt',

    /** States */
    GET_CODE = 'states/get-code',
    GET_STORAGE_AT = 'states/get-storage-at',
    CALL = 'states/call',

    /** Other */
    PROTOBUF_SCHEMA = 'protobuf/schema',
    JSON_RPC = 'json-rpc',

    NOT_IMPLEMENTED = 'not-implemented',
}

export enum RouteType {
    GET = 'get',
    POST = 'post',
    PUT = 'put',
    DELETE = 'del',
    PATCH = 'patch',
    OPTIONS = 'options',
    USE = 'use',
    UPGRADE = 'upgrade',
    ALL = 'all',
    CONNECT = 'connect',
}
