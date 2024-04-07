import { SubscriptionType } from '../enums/Subscriptions.js';
import { BlockSubscription } from '../interfaces/BlockSubscription.js';

export type NewBlockSubscriptionCallback = (blockData: BlockSubscription) => void;

export type PossibleSubscriptions = NewBlockSubscriptionCallback;

export interface TypedNotification extends Record<SubscriptionType, unknown[]> {
    [SubscriptionType.NEW_BLOCK]: [BlockSubscription];
}
