import { Document } from 'mongodb';

export abstract class Aggregation {
    public abstract getAggregation(...params: unknown[]): Document[];
}
