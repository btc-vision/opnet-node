import { Feature, Features } from '@btc-vision/transaction';

export interface AccessListFeature extends Feature<Features.ACCESS_LIST> {
    data: Uint8Array;
}

export interface EpochSubmissionFeature extends Feature<Features.EPOCH_SUBMISSION> {
    data: Uint8Array;
}

export interface MLDSALinkRequest extends Feature<Features.MLDSA_LINK_PUBKEY> {
    data: Uint8Array;
}
