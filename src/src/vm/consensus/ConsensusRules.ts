/**
 * Consensus rule bitfield.
 *
 * This value is sent verbatim to op-vm as a u64, in two places:
 *   - `ContractManager.instantiate()` arg 10 — read before the module is compiled
 *   - `ContractManager.setEnvironmentVariables()` `consensusFlags` — read at runtime
 *
 * op-vm names the same bits differently (`ConsensusFlags` in
 * `src/domain/runner/constants/consensus_flags.rs`), so the mapping is:
 *
 *   bit 0 (0b001)  UNSAFE_QUANTUM_SIGNATURES_ALLOWED  <->  ALLOW_CLASSICAL_SIGNATURES
 *   bit 1 (0b010)  CONTRACT_UPDATES_ALLOWED           <->  UPDATE_CONTRACT_BY_ADDRESS
 *   bit 2 (0b100)  STRICT_MEMORY_METERING             <->  STRICT_MEMORY_METERING
 *
 * Bits 0 and 1 are consumed at runtime by the VM's import functions. Bit 2 is
 * consumed at *compile* time and cannot be changed after instantiation: it
 * selects dynamic memory style, the strict metering middleware, the pre-compile
 * bytecode/module validators (which is what enforces MAX_TABLE_ELEMENTS and
 * MAX_PAGES), and the compiled-artifact cache key. Enabling it changes gas
 * outcomes for existing contracts, so it must be activated at a fork height.
 */
export class ConsensusRules {
    // Flag constants
    public static readonly NONE: bigint = 0b00000000n;

    public static readonly UNSAFE_QUANTUM_SIGNATURES_ALLOWED: bigint = 0b00000001n;
    public static readonly CONTRACT_UPDATES_ALLOWED: bigint = 0b00000010n;

    /** Enables op-vm's strict memory/table limits and metering. Compile-time only. */
    public static readonly STRICT_MEMORY_METERING: bigint = 0b00000100n;

    private value: bigint;

    constructor(value: bigint = 0n) {
        this.value = value;
    }

    /**
     * Creates a new empty ConsensusRules
     */
    public static new(): ConsensusRules {
        return new ConsensusRules(0n);
    }

    /**
     * Creates ConsensusRules from bigint value
     */
    public static fromBigint(value: bigint): ConsensusRules {
        return new ConsensusRules(value);
    }

    /**
     * Helper to create flags from multiple flag values
     */
    public static combine(flags: bigint[]): ConsensusRules {
        let result: bigint = 0n;
        for (let i = 0; i < flags.length; i++) {
            result |= flags[i];
        }
        return new ConsensusRules(result);
    }

    public reset(): void {
        this.value = 0n;
    }

    /**
     * Gets the underlying bigint value
     */
    public asBigInt(): bigint {
        return this.value;
    }

    /**
     * Converts to big-endian byte array
     */
    public toBeBytes(): Uint8Array {
        const bytes = new Uint8Array(8);
        const view = new DataView(bytes.buffer);
        view.setBigInt64(0, this.value, false); // false = big-endian
        return bytes;
    }

    /**
     * Checks if all flags in 'other' are set
     */
    public contains(other: ConsensusRules): boolean {
        return (this.value & other.value) == other.value;
    }

    /**
     * Checks if flag value is set
     */
    public containsFlag(flag: bigint): boolean {
        return (this.value & flag) === flag;
    }

    /**
     * Checks if any flags in 'other' are set
     */
    public intersects(other: ConsensusRules): boolean {
        return (this.value & other.value) !== 0n;
    }

    /**
     * Checks if any flag value is set
     */
    public intersectsFlag(flag: bigint): boolean {
        return (this.value & flag) !== 0n;
    }

    /**
     * Checks if no flags are set
     */
    public isEmpty(): boolean {
        return this.value === 0n;
    }

    /**
     * Returns union of flags
     */
    public union(other: ConsensusRules): ConsensusRules {
        return new ConsensusRules(this.value | other.value);
    }

    /**
     * Returns intersection of flags
     */
    public intersection(other: ConsensusRules): ConsensusRules {
        return new ConsensusRules(this.value & other.value);
    }

    /**
     * Returns difference of flags (flags in this but not in other)
     */
    public difference(other: ConsensusRules): ConsensusRules {
        return new ConsensusRules(this.value & ~other.value);
    }

    /**
     * Returns symmetric difference of flags
     */
    public symmetricDifference(other: ConsensusRules): ConsensusRules {
        return new ConsensusRules(this.value ^ other.value);
    }

    /**
     * Returns complement of flags
     */
    public complement(): ConsensusRules {
        return new ConsensusRules(~this.value);
    }

    /**
     * Inserts flags from other
     */
    public insert(other: ConsensusRules): void {
        this.value |= other.value;
    }

    /**
     * Inserts a flag value
     */
    public insertFlag(flag: bigint): void {
        this.value |= flag;
    }

    /**
     * Removes flags from other
     */
    public remove(other: ConsensusRules): void {
        this.value &= ~other.value;
    }

    /**
     * Removes a flag value
     */
    public removeFlag(flag: bigint): void {
        this.value &= ~flag;
    }

    /**
     * Toggles flags from other
     */
    public toggle(other: ConsensusRules): void {
        this.value ^= other.value;
    }

    /**
     * Toggles a flag value
     */
    public toggleFlag(flag: bigint): void {
        this.value ^= flag;
    }

    /**
     * Sets or clears flags based on value
     */
    public set(other: ConsensusRules, value: boolean): void {
        if (value) {
            this.insert(other);
        } else {
            this.remove(other);
        }
    }

    /**
     * Sets or clears a flag based on value
     */
    public setFlag(flag: bigint, value: boolean): void {
        if (value) {
            this.insertFlag(flag);
        } else {
            this.removeFlag(flag);
        }
    }

    /**
     * Creates a copy of this ConsensusRules
     */
    public clone(): ConsensusRules {
        return new ConsensusRules(this.value);
    }

    /**
     * Checks equality with another ConsensusRules
     */
    public equals(other: ConsensusRules): boolean {
        return this.value == other.value;
    }

    /**
     * Returns binary string representation
     */
    public toBinaryString(): string {
        let result = '';
        let val = this.value;
        for (let i = 0; i < 64; i++) {
            result = (val & 0b1n ? '1' : '0') + result;
            val = val >> 1n;
        }
        return '0b' + result;
    }
}

export function createConsensusRules(flags: bigint[]): ConsensusRules {
    return ConsensusRules.combine(flags);
}
