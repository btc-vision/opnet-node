/**
 * The op-vm builds this node can execute against.
 *
 * A block must always be executed on the runtime that originally produced it,
 * otherwise replaying history yields a different state root than the one the
 * chain committed. {@link OPVMVersion.Legacy} therefore never goes away: it is
 * the only way to reproduce mainnet below 959_317 and testnet below 139_693.
 */
export enum OPVMVersion {
    /** @btc-vision/op-vm 1.0.0, pinned via the op-vm-legacy npm alias. */
    Legacy = 'op-vm@1.0.0',

    /** Whatever @btc-vision/op-vm currently resolves to. */
    Latest = 'op-vm@latest',
}
