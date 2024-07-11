import { ServerChannel } from 'ssh2';

export abstract class Command {
    public abstract readonly command: string;

    protected constructor() {}

    private _channel: ServerChannel | null = null;

    protected get channel(): ServerChannel {
        if (!this._channel) {
            throw new Error('Channel not set');
        }

        return this._channel;
    }

    public execute(channel: ServerChannel): void {
        this._channel = channel;

        this.onExecute();
    }

    protected abstract onExecute(): void;
}
