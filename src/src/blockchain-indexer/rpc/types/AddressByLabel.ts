export enum WalletPurpose {
    Receive = 'receive',
    Change = 'change',
    Send = 'send',
    Legacy = 'legacy',
}

export interface AddressByLabel {
    [key: string]: {
        purpose: WalletPurpose;
    };
}
