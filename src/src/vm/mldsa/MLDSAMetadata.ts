import { MLDSASecurityLevel } from '@btc-vision/transaction';

/**
 * ML-DSA Public Key Metadata enum for quantum-resistant signatures
 */
export enum MLDSAPublicKeyMetadata {
    MLDSA44 = 1312,
    MLDSA65 = 1952,
    MLDSA87 = 2592,
}

/**
 * Utility class for ML-DSA metadata operations
 */
export class MLDSAMetadata {
    /**
     * Creates metadata from security level
     */
    public static fromLevel(level: MLDSASecurityLevel): MLDSAPublicKeyMetadata {
        switch (level) {
            case MLDSASecurityLevel.LEVEL2:
                return MLDSAPublicKeyMetadata.MLDSA44;
            case MLDSASecurityLevel.LEVEL3:
                return MLDSAPublicKeyMetadata.MLDSA65;
            case MLDSASecurityLevel.LEVEL5:
                return MLDSAPublicKeyMetadata.MLDSA87;
            default:
                throw new Error('Invalid ML-DSA security level');
        }
    }

    /**
     * Creates metadata from public key byte length
     */
    public static fromBytesLen(len: number): MLDSAPublicKeyMetadata {
        switch (len) {
            case 1312:
                return MLDSAPublicKeyMetadata.MLDSA44;
            case 1952:
                return MLDSAPublicKeyMetadata.MLDSA65;
            case 2592:
                return MLDSAPublicKeyMetadata.MLDSA87;
            default:
                throw new Error('Invalid ML-DSA public key length');
        }
    }

    /**
     * Converts metadata to security level
     */
    public static toLevel(metadata: MLDSAPublicKeyMetadata): MLDSASecurityLevel {
        switch (metadata) {
            case MLDSAPublicKeyMetadata.MLDSA44:
                return MLDSASecurityLevel.LEVEL2;
            case MLDSAPublicKeyMetadata.MLDSA65:
                return MLDSASecurityLevel.LEVEL3;
            case MLDSAPublicKeyMetadata.MLDSA87:
                return MLDSASecurityLevel.LEVEL5;
            default:
                throw new Error('Invalid ML-DSA metadata');
        }
    }

    /**
     * Gets the NIST security level
     */
    public static securityLevel(metadata: MLDSAPublicKeyMetadata): number {
        switch (metadata) {
            case MLDSAPublicKeyMetadata.MLDSA44:
                return 2;
            case MLDSAPublicKeyMetadata.MLDSA65:
                return 3;
            case MLDSAPublicKeyMetadata.MLDSA87:
                return 5;
            default:
                return 0;
        }
    }

    /**
     * Gets the private key length in bytes
     */
    public static privateKeyLen(metadata: MLDSAPublicKeyMetadata): number {
        switch (metadata) {
            case MLDSAPublicKeyMetadata.MLDSA44:
                return 2560;
            case MLDSAPublicKeyMetadata.MLDSA65:
                return 4032;
            case MLDSAPublicKeyMetadata.MLDSA87:
                return 4896;
            default:
                return 0;
        }
    }

    /**
     * Gets the signature length in bytes
     */
    public static signatureLen(metadata: MLDSAPublicKeyMetadata): number {
        switch (metadata) {
            case MLDSAPublicKeyMetadata.MLDSA44:
                return 2420;
            case MLDSAPublicKeyMetadata.MLDSA65:
                return 3309;
            case MLDSAPublicKeyMetadata.MLDSA87:
                return 4627;
            default:
                return 0;
        }
    }

    /**
     * Gets the algorithm name
     */
    public static name(metadata: MLDSAPublicKeyMetadata): string {
        switch (metadata) {
            case MLDSAPublicKeyMetadata.MLDSA44:
                return 'ML-DSA-44';
            case MLDSAPublicKeyMetadata.MLDSA65:
                return 'ML-DSA-65';
            case MLDSAPublicKeyMetadata.MLDSA87:
                return 'ML-DSA-87';
            default:
                return 'Unknown';
        }
    }

    /**
     * Attempts to create metadata from u32 value
     */
    public static tryFromU32(value: number): MLDSAPublicKeyMetadata {
        return MLDSAMetadata.fromBytesLen(value);
    }

    /**
     * Helper to check if a value is valid metadata
     */
    public static isValid(value: number): boolean {
        return value === 1312 || value === 1952 || value === 2592;
    }
}

// Export constants for convenience
export const MLDSA44_PUBLIC_KEY_LEN: number = 1312;
export const MLDSA65_PUBLIC_KEY_LEN: number = 1952;
export const MLDSA87_PUBLIC_KEY_LEN: number = 2592;

export const MLDSA44_PRIVATE_KEY_LEN: number = 2560;
export const MLDSA65_PRIVATE_KEY_LEN: number = 4032;
export const MLDSA87_PRIVATE_KEY_LEN: number = 4896;

export const MLDSA44_SIGNATURE_LEN: number = 2420;
export const MLDSA65_SIGNATURE_LEN: number = 3309;
export const MLDSA87_SIGNATURE_LEN: number = 4627;
