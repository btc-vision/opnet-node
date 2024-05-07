export enum ConnectionStatus {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    EXCHANGING_KEYS = 'EXCHANGING_KEYS',
    AUTHENTICATING = 'AUTHENTICATING',
    AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
    AUTHENTICATION_SUCCESS = 'AUTHENTICATION_SUCCESS',
}