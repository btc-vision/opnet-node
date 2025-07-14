import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface EpochTemplateParamsAsObject
    extends JSONRpcParams<JSONRpcMethods.GET_EPOCH_TEMPLATE> {}

export type EpochTemplateAsArray = [EpochTemplateParamsAsObject];

export type EpochTemplateParams = EpochTemplateParamsAsObject | EpochTemplateAsArray;
