import { AddressMap } from '@btc-vision/transaction';

export interface ChallengeSolution {
    readonly solutions: AddressMap<Uint8Array[]>;
    readonly legacyPublicKeys: AddressMap<Uint8Array>;
}
