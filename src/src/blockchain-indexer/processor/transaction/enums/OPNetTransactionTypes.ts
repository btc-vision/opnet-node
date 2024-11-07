// DISABLED WBTC 2024-11-07

export enum OPNetTransactionTypes {
    Generic = 'Generic',
    Deployment = 'Deployment',
    Interaction = 'Interaction',
    //WrapInteraction = 'WrapInteraction',
    //UnwrapInteraction = 'UnwrapInteraction',
}

export type InteractionTransactionType = OPNetTransactionTypes.Interaction;
//| OPNetTransactionTypes.WrapInteraction
//| OPNetTransactionTypes.UnwrapInteraction;

export const OPNetInteractionTypeValues: OPNetTransactionTypes[] = [
    OPNetTransactionTypes.Interaction,
    //OPNetTransactionTypes.WrapInteraction,
    //OPNetTransactionTypes.UnwrapInteraction,
    OPNetTransactionTypes.Deployment,
];
