// DISABLED WBTC 2024-11-07

export enum OPNetTransactionTypes {
    Generic = 'Generic',
    Deployment = 'Deployment',
    Interaction = 'Interaction',
}

export type InteractionTransactionType = OPNetTransactionTypes.Interaction;

export const OPNetInteractionTypeValues: OPNetTransactionTypes[] = [
    OPNetTransactionTypes.Interaction,
    OPNetTransactionTypes.Deployment,
];
