import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { ObjectId } from 'mongodb';
import {
    PluginDatabaseAPI,
    PluginDatabaseError,
} from '../../../src/src/plugins/api/PluginDatabaseAPI.js';

describe('PluginDatabaseAPI', () => {
    let mockDb: {
        collection: Mock;
    };
    let mockCollection: {
        find: Mock;
        findOne: Mock;
        insertOne: Mock;
        insertMany: Mock;
        updateOne: Mock;
        updateMany: Mock;
        deleteOne: Mock;
        deleteMany: Mock;
        countDocuments: Mock;
        createIndex: Mock;
    };
    let mockCursor: {
        toArray: Mock;
        limit: Mock;
        skip: Mock;
        sort: Mock;
    };

    beforeEach(() => {
        mockCursor = {
            toArray: vi.fn(() => Promise.resolve([])),
            limit: vi.fn(function () {
                return mockCursor;
            }),
            skip: vi.fn(function () {
                return mockCursor;
            }),
            sort: vi.fn(function () {
                return mockCursor;
            }),
        };

        mockCollection = {
            find: vi.fn(() => mockCursor),
            findOne: vi.fn(() => Promise.resolve(null)),
            insertOne: vi.fn(() => Promise.resolve({ insertedId: new ObjectId() })),
            insertMany: vi.fn(() =>
                Promise.resolve({
                    insertedIds: { 0: new ObjectId(), 1: new ObjectId() },
                }),
            ),
            updateOne: vi.fn(() => Promise.resolve({ modifiedCount: 1 })),
            updateMany: vi.fn(() => Promise.resolve({ modifiedCount: 5 })),
            deleteOne: vi.fn(() => Promise.resolve({ deletedCount: 1 })),
            deleteMany: vi.fn(() => Promise.resolve({ deletedCount: 3 })),
            countDocuments: vi.fn(() => Promise.resolve(10)),
            createIndex: vi.fn(() => Promise.resolve('index_name')),
        };

        mockDb = {
            collection: vi.fn(() => mockCollection),
        };
    });

    describe('PluginDatabaseError', () => {
        it('should create error with message and code', () => {
            const error = new PluginDatabaseError('Test error', 'TEST_CODE');
            expect(error.message).toBe('Test error');
            expect(error.code).toBe('TEST_CODE');
            expect(error.name).toBe('PluginDatabaseError');
        });

        it('should create error with collection name', () => {
            const error = new PluginDatabaseError('Test error', 'TEST_CODE', 'my-collection');
            expect(error.collection).toBe('my-collection');
        });
    });

    describe('constructor', () => {
        it('should initialize with plugin ID and permitted collections', () => {
            const api = new PluginDatabaseAPI(
                'test-plugin',
                ['users', 'posts'],
                mockDb as never,
            );
            expect(api).toBeInstanceOf(PluginDatabaseAPI);
        });
    });

    describe('collection', () => {
        it('should throw when collection not permitted', () => {
            const api = new PluginDatabaseAPI('test-plugin', ['users'], mockDb as never);

            expect(() => api.collection('posts')).toThrow(PluginDatabaseError);
            expect(() => api.collection('posts')).toThrow('COLLECTION_NOT_PERMITTED');
        });

        it('should return collection when permitted', () => {
            const api = new PluginDatabaseAPI('test-plugin', ['users'], mockDb as never);

            const collection = api.collection('users');

            expect(collection).toBeDefined();
            expect(mockDb.collection).toHaveBeenCalledWith('test-plugin_users');
        });

        it('should prefix collection name with plugin ID', () => {
            const api = new PluginDatabaseAPI('my-plugin', ['data'], mockDb as never);

            api.collection('data');

            expect(mockDb.collection).toHaveBeenCalledWith('my-plugin_data');
        });

        it('should cache collection instances', () => {
            const api = new PluginDatabaseAPI('test-plugin', ['users'], mockDb as never);

            const collection1 = api.collection('users');
            const collection2 = api.collection('users');

            expect(collection1).toBe(collection2);
            expect(mockDb.collection).toHaveBeenCalledTimes(1);
        });
    });

    describe('listCollections', () => {
        it('should return list of permitted collections', () => {
            const api = new PluginDatabaseAPI(
                'test-plugin',
                ['users', 'posts', 'comments'],
                mockDb as never,
            );

            const collections = api.listCollections();

            expect(collections).toEqual(['users', 'posts', 'comments']);
        });

        it('should return empty array when no collections permitted', () => {
            const api = new PluginDatabaseAPI('test-plugin', [], mockDb as never);

            const collections = api.listCollections();

            expect(collections).toEqual([]);
        });
    });

    describe('PluginCollection', () => {
        let api: PluginDatabaseAPI;

        beforeEach(() => {
            api = new PluginDatabaseAPI('test-plugin', ['users'], mockDb as never);
        });

        describe('find', () => {
            it('should return cursor', () => {
                const collection = api.collection('users');
                const cursor = collection.find({ name: 'test' });

                expect(cursor).toBeDefined();
                expect(mockCollection.find).toHaveBeenCalledWith({ name: 'test' });
            });
        });

        describe('findOne', () => {
            it('should return null when document not found', async () => {
                mockCollection.findOne.mockResolvedValue(null);

                const collection = api.collection('users');
                const result = await collection.findOne({ _id: 'nonexistent' });

                expect(result).toBeNull();
            });

            it('should return document when found', async () => {
                const mockDoc = { _id: '123', name: 'Test User' };
                mockCollection.findOne.mockResolvedValue(mockDoc);

                const collection = api.collection('users');
                const result = await collection.findOne({ _id: '123' });

                expect(result).toEqual(mockDoc);
            });
        });

        describe('insertOne', () => {
            it('should insert document and return insertedId', async () => {
                const insertedId = new ObjectId();
                mockCollection.insertOne.mockResolvedValue({ insertedId });

                const collection = api.collection('users');
                const result = await collection.insertOne({ name: 'New User' });

                expect(result.insertedId).toBe(insertedId.toString());
                expect(mockCollection.insertOne).toHaveBeenCalledWith({ name: 'New User' });
            });
        });

        describe('insertMany', () => {
            it('should insert multiple documents and return insertedIds', async () => {
                const id1 = new ObjectId();
                const id2 = new ObjectId();
                mockCollection.insertMany.mockResolvedValue({
                    insertedIds: { 0: id1, 1: id2 },
                });

                const collection = api.collection('users');
                const result = await collection.insertMany([{ name: 'User 1' }, { name: 'User 2' }]);

                expect(result.insertedIds).toHaveLength(2);
                expect(result.insertedIds).toContain(id1.toString());
                expect(result.insertedIds).toContain(id2.toString());
            });
        });

        describe('updateOne', () => {
            it('should update one document and return modifiedCount', async () => {
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

                const collection = api.collection('users');
                const result = await collection.updateOne(
                    { _id: '123' },
                    { $set: { name: 'Updated' } },
                );

                expect(result.modifiedCount).toBe(1);
                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    { _id: '123' },
                    { $set: { name: 'Updated' } },
                );
            });

            it('should return 0 when no document matched', async () => {
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 0 });

                const collection = api.collection('users');
                const result = await collection.updateOne({ _id: 'nonexistent' }, { $set: {} });

                expect(result.modifiedCount).toBe(0);
            });
        });

        describe('updateMany', () => {
            it('should update multiple documents and return modifiedCount', async () => {
                mockCollection.updateMany.mockResolvedValue({ modifiedCount: 5 });

                const collection = api.collection('users');
                const result = await collection.updateMany(
                    { status: 'active' },
                    { $set: { verified: true } },
                );

                expect(result.modifiedCount).toBe(5);
            });
        });

        describe('deleteOne', () => {
            it('should delete one document and return deletedCount', async () => {
                mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

                const collection = api.collection('users');
                const result = await collection.deleteOne({ _id: '123' });

                expect(result.deletedCount).toBe(1);
                expect(mockCollection.deleteOne).toHaveBeenCalledWith({ _id: '123' });
            });
        });

        describe('deleteMany', () => {
            it('should delete multiple documents and return deletedCount', async () => {
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 3 });

                const collection = api.collection('users');
                const result = await collection.deleteMany({ status: 'inactive' });

                expect(result.deletedCount).toBe(3);
            });
        });

        describe('countDocuments', () => {
            it('should count all documents when no query', async () => {
                mockCollection.countDocuments.mockResolvedValue(100);

                const collection = api.collection('users');
                const result = await collection.countDocuments();

                expect(result).toBe(100);
            });

            it('should count documents matching query', async () => {
                mockCollection.countDocuments.mockResolvedValue(25);

                const collection = api.collection('users');
                const result = await collection.countDocuments({ status: 'active' });

                expect(result).toBe(25);
                expect(mockCollection.countDocuments).toHaveBeenCalledWith({ status: 'active' });
            });
        });

        describe('createIndex', () => {
            it('should create index and return index name', async () => {
                mockCollection.createIndex.mockResolvedValue('name_1');

                const collection = api.collection('users');
                const result = await collection.createIndex({ name: 1 });

                expect(result).toBe('name_1');
                expect(mockCollection.createIndex).toHaveBeenCalledWith({ name: 1 }, undefined);
            });

            it('should create index with options', async () => {
                mockCollection.createIndex.mockResolvedValue('email_unique');

                const collection = api.collection('users');
                const result = await collection.createIndex(
                    { email: 1 },
                    { unique: true, name: 'email_unique' },
                );

                expect(result).toBe('email_unique');
                expect(mockCollection.createIndex).toHaveBeenCalledWith(
                    { email: 1 },
                    { unique: true, name: 'email_unique' },
                );
            });
        });
    });

    describe('PluginCursor', () => {
        let api: PluginDatabaseAPI;

        beforeEach(() => {
            api = new PluginDatabaseAPI('test-plugin', ['users'], mockDb as never);
        });

        describe('toArray', () => {
            it('should return array of documents', async () => {
                const mockDocs = [{ name: 'User 1' }, { name: 'User 2' }];
                mockCursor.toArray.mockResolvedValue(mockDocs);

                const collection = api.collection('users');
                const result = await collection.find({}).toArray();

                expect(result).toEqual(mockDocs);
            });
        });

        describe('limit', () => {
            it('should return cursor and apply limit on toArray', async () => {
                mockCursor.toArray.mockResolvedValue([{ name: 'User 1' }]);

                const collection = api.collection('users');
                const cursor = collection.find({}).limit(10);
                await cursor.toArray();

                expect(mockCursor.limit).toHaveBeenCalledWith(10);
            });
        });

        describe('skip', () => {
            it('should return cursor and apply skip on toArray', async () => {
                mockCursor.toArray.mockResolvedValue([]);

                const collection = api.collection('users');
                const cursor = collection.find({}).skip(5);
                await cursor.toArray();

                expect(mockCursor.skip).toHaveBeenCalledWith(5);
            });
        });

        describe('sort', () => {
            it('should return cursor and apply sort on toArray', async () => {
                mockCursor.toArray.mockResolvedValue([]);

                const collection = api.collection('users');
                const cursor = collection.find({}).sort({ name: 1 });
                await cursor.toArray();

                expect(mockCursor.sort).toHaveBeenCalledWith({ name: 1 });
            });
        });

        describe('chaining', () => {
            it('should support method chaining', async () => {
                mockCursor.toArray.mockResolvedValue([]);

                const collection = api.collection('users');
                await collection.find({}).skip(10).limit(5).sort({ createdAt: -1 }).toArray();

                expect(mockCursor.skip).toHaveBeenCalledWith(10);
                expect(mockCursor.limit).toHaveBeenCalledWith(5);
                expect(mockCursor.sort).toHaveBeenCalledWith({ createdAt: -1 });
            });
        });
    });
});
