import { AddressMap } from '@btc-vision/transaction';

export interface ChallengeSolution {
    readonly solutions: AddressMap<Buffer[]>;
    readonly legacyPublicKeys: AddressMap<Buffer>;
}
