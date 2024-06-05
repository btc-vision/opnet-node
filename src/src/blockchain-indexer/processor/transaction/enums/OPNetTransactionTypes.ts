export enum OPNetTransactionTypes {
    Generic = 'Generic',
    Deployment = 'Deployment',
    Interaction = 'Interaction',
    WrapInteraction = 'WrapInteraction',
}

export type InteractionTransactionType =
    | OPNetTransactionTypes.Interaction
    | OPNetTransactionTypes.WrapInteraction;
