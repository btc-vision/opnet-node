export enum MessageType {
    THREAD_RESPONSE,
    LINK_THREAD,
    SET_MESSAGE_PORT,
    LINK_THREAD_REQUEST,
    RPC_METHOD,

    BLOCK_PROCESSED,
    CURRENT_INDEXER_BLOCK,
    START_INDEXER,
    EXIT_THREAD,

    DESERIALIZE_BLOCK,
    CHAIN_REORG,

    GET_PEERS,

    // Plugin messages
    PLUGIN_READY, // Sent by PluginThread when initialization is complete
    ALL_THREADS_READY, // Sent by Core to plugin thread after all threads are started
    PLUGIN_BLOCK_PRE_PROCESS,
    PLUGIN_BLOCK_POST_PROCESS,
    PLUGIN_BLOCK_CHANGE,
    PLUGIN_EPOCH_CHANGE,
    PLUGIN_EPOCH_FINALIZED,
    PLUGIN_REORG,

    // Plugin API integration
    PLUGIN_REGISTER_ROUTES, // Plugin notifies about new routes
    PLUGIN_UNREGISTER_ROUTES, // Plugin notifies routes should be removed
    PLUGIN_EXECUTE_ROUTE, // API thread requests route execution
    PLUGIN_ROUTE_RESULT, // Plugin thread returns route result

    // Plugin WebSocket integration
    PLUGIN_REGISTER_OPCODES, // Plugin notifies about new opcodes
    PLUGIN_UNREGISTER_OPCODES, // Plugin notifies opcodes should be removed
    PLUGIN_EXECUTE_WS_HANDLER, // API thread requests WS handler execution
    PLUGIN_WS_RESULT, // Plugin thread returns WS result
}
