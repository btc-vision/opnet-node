import { IPluginMetadata } from './IPluginMetadata.js';

/**
 * Magic bytes identifying .opnet files
 * ASCII: "OPNETPLG"
 */
export const PLUGIN_MAGIC_BYTES = new TextEncoder().encode('OPNETPLG');

/**
 * Current format version
 */
export const PLUGIN_FORMAT_VERSION = 1;

/**
 * MLDSA security levels
 */
export enum MLDSALevel {
    MLDSA44 = 0,
    MLDSA65 = 1,
    MLDSA87 = 2,
}

/**
 * MLDSA public key sizes by level
 */
export const MLDSA_PUBLIC_KEY_SIZES: Record<MLDSALevel, number> = {
    [MLDSALevel.MLDSA44]: 1312,
    [MLDSALevel.MLDSA65]: 1952,
    [MLDSALevel.MLDSA87]: 2592,
};

/**
 * MLDSA signature sizes by level
 */
export const MLDSA_SIGNATURE_SIZES: Record<MLDSALevel, number> = {
    [MLDSALevel.MLDSA44]: 2420,
    [MLDSALevel.MLDSA65]: 3309,
    [MLDSALevel.MLDSA87]: 4627,
};

/**
 * Parsed plugin file structure
 */
export interface IParsedPluginFile {
    /** Format version */
    readonly formatVersion: number;

    /** MLDSA security level */
    readonly mldsaLevel: MLDSALevel;

    /** MLDSA public key */
    readonly publicKey: Uint8Array;

    /** MLDSA signature over checksum */
    readonly signature: Uint8Array;

    /** Parsed metadata JSON */
    readonly metadata: IPluginMetadata;

    /** Raw metadata JSON string */
    readonly rawMetadata: string;

    /** Compiled bytecode (.jsc) */
    readonly bytecode: Uint8Array;

    /** Optional protobuf schema for WebSocket */
    readonly proto?: Uint8Array;

    /** SHA-256 checksum of metadata + bytecode + proto */
    readonly checksum: Uint8Array;
}

/**
 * Plugin file header structure
 */
export interface IPluginFileHeader {
    /** Magic bytes (8 bytes) */
    readonly magic: Uint8Array;

    /** Format version (4 bytes, uint32 LE) */
    readonly version: number;

    /** MLDSA level (1 byte) */
    readonly mldsaLevel: MLDSALevel;

    /** Public key (variable size based on level) */
    readonly publicKey: Uint8Array;

    /** Signature (variable size based on level) */
    readonly signature: Uint8Array;
}

/**
 * Plugin file offsets for parsing
 */
export interface IPluginFileOffsets {
    /** Offset to metadata length field */
    readonly metadataLengthOffset: number;

    /** Offset to metadata content */
    readonly metadataOffset: number;

    /** Offset to bytecode length field */
    readonly bytecodeLengthOffset: number;

    /** Offset to bytecode content */
    readonly bytecodeOffset: number;

    /** Offset to proto length field */
    readonly protoLengthOffset: number;

    /** Offset to proto content */
    readonly protoOffset: number;

    /** Offset to checksum */
    readonly checksumOffset: number;

    /** Total file size */
    readonly totalSize: number;
}

/**
 * Calculate header size based on MLDSA level
 */
export function calculateHeaderSize(level: MLDSALevel): number {
    return (
        8 + // Magic bytes
        4 + // Format version
        1 + // MLDSA level
        MLDSA_PUBLIC_KEY_SIZES[level] + // Public key
        MLDSA_SIGNATURE_SIZES[level] // Signature
    );
}

/**
 * Minimum valid .opnet file size
 */
export const MIN_PLUGIN_FILE_SIZE =
    8 + // Magic
    4 + // Version
    1 + // MLDSA level
    MLDSA_PUBLIC_KEY_SIZES[MLDSALevel.MLDSA44] + // Min public key
    MLDSA_SIGNATURE_SIZES[MLDSALevel.MLDSA44] + // Min signature
    4 + // Metadata length
    2 + // Min metadata "{}"
    4 + // Bytecode length
    1 + // Min bytecode
    4 + // Proto length (0)
    32; // Checksum

/**
 * Maximum metadata size (1MB)
 */
export const MAX_METADATA_SIZE = 1024 * 1024;

/**
 * Maximum bytecode size (100MB)
 */
export const MAX_BYTECODE_SIZE = 100 * 1024 * 1024;

/**
 * Maximum proto size (1MB)
 */
export const MAX_PROTO_SIZE = 1024 * 1024;
