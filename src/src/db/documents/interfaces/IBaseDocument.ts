import { Document, WithId } from 'mongodb';

export interface IBaseDocument extends WithId<Document> {
    version: number;
}
