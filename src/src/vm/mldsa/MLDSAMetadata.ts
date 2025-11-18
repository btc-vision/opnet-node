export enum MLDSASecurityLevel {
    Level2 = 0,
    Level3 = 1,
    Level5 = 2,
}

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
    static fromLevel(level: MLDSASecurityLevel): MLDSAPublicKeyMetadata {
        switch (level) {
            case MLDSASecurityLevel.Level2:
                return MLDSAPublicKeyMetadata.MLDSA44;
            case MLDSASecurityLevel.Level3:
                return MLDSAPublicKeyMetadata.MLDSA65;
            case MLDSASecurityLevel.Level5:
                return MLDSAPublicKeyMetadata.MLDSA87;
            default:
                throw new Error('Invalid ML-DSA security level');
        }
    }

    /**
     * Creates metadata from public key byte length
     */
    static fromBytesLen(len: number): MLDSAPublicKeyMetadata {
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
    static toLevel(metadata: MLDSAPublicKeyMetadata): number {
        switch (metadata) {
            case MLDSAPublicKeyMetadata.MLDSA44:
                return 0;
            case MLDSAPublicKeyMetadata.MLDSA65:
                return 1;
            case MLDSAPublicKeyMetadata.MLDSA87:
                return 2;
            default:
                return 0;
        }
    }

    /**
     * Gets the NIST security level
     */
    static securityLevel(metadata: MLDSAPublicKeyMetadata): number {
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
    static privateKeyLen(metadata: MLDSAPublicKeyMetadata): number {
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
    static signatureLen(metadata: MLDSAPublicKeyMetadata): number {
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
    static name(metadata: MLDSAPublicKeyMetadata): string {
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
    static tryFromU32(value: number): MLDSAPublicKeyMetadata {
        return MLDSAMetadata.fromBytesLen(value);
    }

    /**
     * Helper to check if a value is valid metadata
     */
    static isValid(value: number): boolean {
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
