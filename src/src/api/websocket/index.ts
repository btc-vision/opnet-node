// Core exports
export { WebSocketManager, WSManager, type WebSocketMetrics } from './WebSocketManager.js';
export {
    WebSocketClient,
    ConnectionState,
    type WebSocketClientConfig,
    type Subscription,
    SubscriptionType,
} from './WebSocketClient.js';
export {
    ProtocolHandler,
    Protocol,
    WebSocketAPIError,
    PROTOCOL_VERSION,
    MIN_PROTOCOL_VERSION,
    MAX_PROTOCOL_VERSION,
} from './ProtocolHandler.js';
export { OpcodeRegistry, APIRegistry, type OpcodeHandler } from './OpcodeRegistry.js';

// Packet exports
export {
    APIPacket,
    type PackedMessage,
    type WebSocketMessage,
    parseWebSocketMessage,
} from './packets/APIPacket.js';
export { APIPacketType } from './packets/types/APIPacketTypes.js';

// Type exports
export {
    WebSocketRequestOpcode,
    WebSocketResponseOpcode,
    type WebSocketOpcode,
    RequestToResponseOpcode,
    OpcodeNames,
} from './types/opcodes/WebSocketOpcodes.js';
export {
    ProtocolError,
    AuthError,
    ResourceError,
    ValidationError,
    InternalError,
    type WebSocketErrorCode,
    ErrorMessages,
    getErrorMessage,
    isProtocolError,
    isFatalError,
} from './types/errors/WebSocketErrorCodes.js';
export {
    SubscriptionType as SubscriptionTypeEnum,
    getSubscriptionTypeName,
} from './types/enums/SubscriptionType.js';

// Message type exports
export * from './types/messages/APIMessages.js';

// Handler exports
export { HandlerRegistry, Handlers } from './handlers/HandlerRegistry.js';

// Proto loader
export { APIProtobufLoader } from './proto/APIProtobufLoader.js';
