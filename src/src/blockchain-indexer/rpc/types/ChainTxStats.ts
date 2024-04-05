export interface ChainTxStats {
    time: number;
    txcount: number;
    window_final_block_hash: string;
    window_final_block_height: number;
    window_block_count: number;
    window_tx_count?: number;
    window_interval?: number;
    txrate?: number;
}
