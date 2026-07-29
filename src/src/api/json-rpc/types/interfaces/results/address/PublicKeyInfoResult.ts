import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface PublicKeyInfo {
    originalPubKey?: string;
    tweakedPubkey?: string;

    p2tr?: string;
    p2op?: string;

    lowByte?: number;

    p2pkh?: string;
    readonly p2pkhUncompressed?: string;
    readonly p2pkhHybrid?: string;

    p2shp2wpkh?: string;
    p2wpkh?: string;

    /**
     * The 32-byte OPNet identity.
     *
     * NOT a linkage signal. When the query itself was a 32-byte key this is the
     * echoed input, because that is the identity the caller asked about and what
     * the address and p2op are derived from — it is present whether or not a link
     * exists. Use {@link mldsaLinked} to test linkage.
     */
    mldsaHashedPublicKey?: string;

    /**
     * Whether an ML-DSA link actually exists on-chain for the queried key.
     *
     * This is the field to branch on when deciding whether a link request must
     * reveal the ML-DSA public key. Treating a present `mldsaHashedPublicKey` as
     * "already linked" reports a false positive for 32-byte queries, which makes
     * clients skip the reveal on a FIRST link and get rejected with
     * "A new ML-DSA link must reveal the public key and a valid ML-DSA signature."
     *
     * Absent on responses from nodes older than this field.
     */
    mldsaLinked?: boolean;

    mldsaLevel?: MLDSASecurityLevel;
    mldsaPublicKey?: string | null;
}

export interface IPubKeyNotFoundError {
    readonly error: string;
}

export interface IPublicKeyInfoResult {
    [key: string]: PublicKeyInfo | IPubKeyNotFoundError;
}

export type PublicKeyInfoResult = JSONRpc2ResultData<JSONRpcMethods.PUBLIC_KEY_INFO> &
    IPublicKeyInfoResult;
