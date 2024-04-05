import { ThreadTypes } from '../enums/ThreadTypes.js';

export interface IThread<T extends ThreadTypes> {
    readonly threadType: T;
}
