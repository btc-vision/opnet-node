export class NetEvent {
    public constructor(
        public eventType: string,
        public eventData: Uint8Array,
    ) {}
}
