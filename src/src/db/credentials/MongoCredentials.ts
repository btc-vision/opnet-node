export enum MONGO_CONNECTION_TYPE {
    TESTNET = 'TESTNET',
    PRODUCTION = 'PRODUCTION',
}

export interface MongoCredentialsDTO {
    readonly username: string;
    readonly password: string;

    readonly host: string;
    readonly port: string;

    readonly prefix?: string;

    readonly databaseName: string;
    readonly databaseMode: MONGO_CONNECTION_TYPE;
}

export class MongoCredentials {
    public readonly databaseName: string = '';
    protected username: string = '';
    protected password: string = '';
    protected host: string = '';
    protected port: string = '';
    protected databaseMode: MONGO_CONNECTION_TYPE;

    protected prefix: string = ``;

    constructor(creds: MongoCredentialsDTO) {
        this.username = creds.username;
        this.password = creds.password;

        this.host = creds.host;
        this.port = creds.port;

        this.prefix = creds.prefix || '';

        this.databaseName = creds.databaseName;
        this.databaseMode = creds.databaseMode;
    }

    public get connectionUri(): string {
        if (this.prefix) {
            return `mongodb${this.prefix}://${this.username}:${this.password}@${this.host}/${this.databaseName}`;
        } else {
            return `mongodb://${this.username}:${this.password}@${this.host}:${this.port}`;
        }
    }
}
