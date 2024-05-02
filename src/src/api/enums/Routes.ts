export enum Routes {
    /** Block */
    LATEST_BLOCK = 'block/latest',

    BLOCK_BY_HASH = 'block/by-hash',
    BLOCK_BY_ID = 'block/by-id',

    /** Address */
    UTXOS = 'address/utxos',
    GET_BALANCE = 'address/get-balance',

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
