export type NetworkingEventHandler<U = object> = (data: U) => Promise<void>;
