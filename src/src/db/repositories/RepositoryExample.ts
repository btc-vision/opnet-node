import { Document } from 'mongodb';
import { Repository } from './Repository.js';

interface Test extends Document {
    name: string;
}
export class ExampleRepository extends Repository {
    public moduleName: string = 'DBManager';
    public logColor: string = '#afeeee';

    constructor() {
        super();
    }

    public async getSomething(): Promise<unknown> {
        const collection = this.getCollection<Test>('test');
        //..
        const a = await collection.findOne({ name: 'ddd' });


        

        return null;
    }
}
