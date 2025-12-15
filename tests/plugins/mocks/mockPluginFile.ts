import * as crypto from 'crypto';
import {
    IParsedPluginFile,
    MLDSALevel,
    MLDSA_PUBLIC_KEY_SIZES,
    MLDSA_SIGNATURE_SIZES,
    PLUGIN_MAGIC_BYTES,
    PLUGIN_FORMAT_VERSION,
} from '../../../src/src/plugins/interfaces/IPluginFile.js';
import { IPluginMetadata } from '../../../src/src/plugins/interfaces/IPluginMetadata.js';
import { createMockMetadata } from './mockPluginMetadata.js';

export function createMockPublicKey(level: MLDSALevel = MLDSALevel.MLDSA44): Buffer {
    return Buffer.alloc(MLDSA_PUBLIC_KEY_SIZES[level], 0x01);
}

export function createMockSignature(level: MLDSALevel = MLDSALevel.MLDSA44): Buffer {
    return Buffer.alloc(MLDSA_SIGNATURE_SIZES[level], 0x02);
}

export function createMockBytecode(size: number = 100): Buffer {
    return Buffer.alloc(size, 0x03);
}

export function computeChecksum(rawMetadata: string, bytecode: Buffer, proto?: Buffer): Buffer {
    const hash = crypto.createHash('sha256');
    hash.update(rawMetadata);
    hash.update(bytecode);
    if (proto) {
        hash.update(proto);
    }
    return hash.digest();
}

export function createMockParsedPluginFile(
    metadataOverrides: Partial<IPluginMetadata> = {},
    options: {
        mldsaLevel?: MLDSALevel;
        bytecodeSize?: number;
        includeProto?: boolean;
    } = {},
): IParsedPluginFile {
    const mldsaLevel = options.mldsaLevel ?? MLDSALevel.MLDSA44;
    const metadata = createMockMetadata(metadataOverrides);
    const rawMetadata = JSON.stringify(metadata);
    const bytecode = createMockBytecode(options.bytecodeSize ?? 100);
    const proto = options.includeProto ? Buffer.from('syntax = "proto3";') : undefined;
    const checksum = computeChecksum(rawMetadata, bytecode, proto);

    return {
        formatVersion: PLUGIN_FORMAT_VERSION,
        mldsaLevel,
        publicKey: createMockPublicKey(mldsaLevel),
        signature: createMockSignature(mldsaLevel),
        metadata,
        rawMetadata,
        bytecode,
        proto,
        checksum,
    };
}

export function createPluginFileBuffer(
    metadata: IPluginMetadata,
    options: {
        mldsaLevel?: MLDSALevel;
        bytecodeSize?: number;
        includeProto?: boolean;
        invalidMagic?: boolean;
        invalidVersion?: boolean;
        invalidChecksum?: boolean;
    } = {},
): Buffer {
    const mldsaLevel = options.mldsaLevel ?? MLDSALevel.MLDSA44;
    const rawMetadata = JSON.stringify(metadata);
    const bytecode = createMockBytecode(options.bytecodeSize ?? 100);
    const proto = options.includeProto ? Buffer.from('syntax = "proto3";') : undefined;

    // Build the file buffer
    const parts: Buffer[] = [];

    // Magic bytes
    if (options.invalidMagic) {
        parts.push(Buffer.from('INVALID!', 'ascii'));
    } else {
        parts.push(PLUGIN_MAGIC_BYTES);
    }

    // Version
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32LE(options.invalidVersion ? 999 : PLUGIN_FORMAT_VERSION, 0);
    parts.push(versionBuf);

    // MLDSA level
    const levelBuf = Buffer.alloc(1);
    levelBuf.writeUInt8(mldsaLevel, 0);
    parts.push(levelBuf);

    // Public key
    parts.push(createMockPublicKey(mldsaLevel));

    // Signature
    parts.push(createMockSignature(mldsaLevel));

    // Metadata length + content
    const metadataBuf = Buffer.from(rawMetadata, 'utf8');
    const metadataLenBuf = Buffer.alloc(4);
    metadataLenBuf.writeUInt32LE(metadataBuf.length, 0);
    parts.push(metadataLenBuf);
    parts.push(metadataBuf);

    // Bytecode length + content
    const bytecodeLenBuf = Buffer.alloc(4);
    bytecodeLenBuf.writeUInt32LE(bytecode.length, 0);
    parts.push(bytecodeLenBuf);
    parts.push(bytecode);

    // Proto length + content
    const protoLenBuf = Buffer.alloc(4);
    if (proto) {
        protoLenBuf.writeUInt32LE(proto.length, 0);
        parts.push(protoLenBuf);
        parts.push(proto);
    } else {
        protoLenBuf.writeUInt32LE(0, 0);
        parts.push(protoLenBuf);
    }

    // Checksum
    if (options.invalidChecksum) {
        parts.push(Buffer.alloc(32, 0xff)); // Invalid checksum
    } else {
        parts.push(computeChecksum(rawMetadata, bytecode, proto));
    }

    return Buffer.concat(parts);
}

export function createMinimalPluginFileBuffer(): Buffer {
    const metadata = createMockMetadata();
    return createPluginFileBuffer(metadata, { bytecodeSize: 10 });
}

export function createTruncatedPluginFileBuffer(): Buffer {
    // Return a buffer that's too small to be valid
    return Buffer.alloc(50, 0x00);
}
