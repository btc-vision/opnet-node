import { Logger } from '@btc-vision/bsi-common';

export abstract class PeerNetworkingManager extends Logger {
    public send: (data: Uint8Array | Buffer) => Promise<void> = async () => {
        throw new Error('Method not implemented.');
    };

    public disconnectPeer: (code: number, reason?: string) => Promise<void> = async () => {
        throw new Error('Method not implemented.');
    };

    public abstract onMessage(rawBuf: Uint8Array): Promise<boolean>;
}
