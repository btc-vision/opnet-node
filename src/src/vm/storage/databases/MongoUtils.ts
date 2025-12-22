import { Db } from 'mongodb';
import { BuildInfo } from './BuildInfo.js';

export async function getMongodbMajorVersion(db: Db): Promise<number> {
    const dbVersion = (await db.command({ buildInfo: 1 })) as BuildInfo;
    const versionParts = dbVersion.version.split('.');

    return parseInt(versionParts[0], 10);
}
