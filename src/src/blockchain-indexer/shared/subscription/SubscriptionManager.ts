import { Logger } from '@btc-vision/bsi-common';
import { SubscriptionType } from '../enums/Subscriptions.js';
import { PossibleSubscriptions, TypedNotification } from './PossibleSubscriptions.js';

export class SubscriptionManager extends Logger {
    private readonly subscriptions: Map<SubscriptionType, PossibleSubscriptions[]> = new Map<
        SubscriptionType,
        PossibleSubscriptions[]
    >();

    constructor() {
        super();
    }

    public subscribe(subscriptionType: SubscriptionType, cb: PossibleSubscriptions): void {
        if (!this.subscriptions.has(subscriptionType)) {
            this.subscriptions.set(subscriptionType, []);
        }

        this.subscriptions.get(subscriptionType)?.push(cb);
    }

    public unsubscribe(subscriptionType: SubscriptionType, cb: PossibleSubscriptions): void {
        if (!this.subscriptions.has(subscriptionType)) {
            return;
        }

        const index = this.subscriptions.get(subscriptionType)?.indexOf(cb);
        if (index !== -1 && index) {
            this.subscriptions.get(subscriptionType)?.splice(index, 1);
        }
    }

    public notify<T extends SubscriptionType>(
        subscriptionType: T,
        ...args: TypedNotification[T]
    ): void {
        if (!this.subscriptions.has(subscriptionType)) {
            return;
        }

        this.subscriptions.get(subscriptionType)?.forEach((cb) => cb.apply(null, args));
    }

    public clear(): void {
        this.subscriptions.clear();
    }
}
