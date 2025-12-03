import { Feature, Features } from '@btc-vision/transaction';

export interface AccessListFeature extends Feature<Features.ACCESS_LIST> {
    data: Buffer;
}

export interface EpochSubmissionFeature extends Feature<Features.EPOCH_SUBMISSION> {
    data: Buffer;
}

export interface MLDSALinkRequest extends Feature<Features.MLDSA_LINK_PUBKEY> {
    data: Buffer;
}
