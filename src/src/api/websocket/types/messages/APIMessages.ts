import { SubscriptionType } from '../enums/SubscriptionType.js';

/**
 * Represents an active subscription for a WebSocket client.
 */
export interface Subscription {
    /** Unique subscription ID */
    readonly id: number;

    /** Type of subscription */
    readonly type: SubscriptionType;

    /** Timestamp when subscription was created */
    readonly createdAt: number;
}
