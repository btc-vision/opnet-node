import { SubscriptionType } from '../enums/Subscriptions.js';
import { NewBlockSubscription } from '../interfaces/NewBlockSubscription.js';

export type NewBlockSubscriptionCallback = (blockData: NewBlockSubscription) => void;

export type PossibleSubscriptions = NewBlockSubscriptionCallback;

export interface TypedNotification extends Record<SubscriptionType, unknown[]> {
    [SubscriptionType.NEW_BLOCK]: [NewBlockSubscription];
}
