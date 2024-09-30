// @ts-expect-error - No types available
import Generator from '@asyncapi/generator';
import { Globals, Logger } from '@btc-vision/bsi-common';
import AsyncApiValidator from 'asyncapi-validator';

import express, { Express } from 'express';
import fs from 'fs';
import openapi from 'openapi-comment-parser';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { Config } from '../config/Config.js';

Globals.register();

const spec = openapi({
    cwd: __dirname,
    include: [
        '../../components/openapi.yaml',
        '../api/Server.js',
        '../../components/schemas/_index.yaml',
        '../api/routes/*',
        '../api/routes/api/**',
        '../api/routes/api/**/*',
    ], //
    verbose: true,
    throwLevel: 'on',
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-assignment
const generator: Generator = new Generator(
    '@asyncapi/html-template',
    path.resolve(__dirname, '../asyncapi/'),
);

export class Docs extends Logger {
    public readonly moduleName: string = 'APIDocs';
    public readonly logColor: string = 'c71585';

    private readonly appDocs: Express = express();

    public constructor() {
        super();
    }

    public async generateAsyncApi(): Promise<void> {
        fs.rmSync('./asyncapi', { recursive: true, force: true });

        const path2 = path.resolve(__dirname, '../../components/opnet.yaml');
        await AsyncApiValidator.fromSource(path2).catch((e: unknown) => {
            this.error(`AsyncAPI validation failed. {Details: ${(e as Error).stack}}`);
        });

        // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
        await generator.generateFromFile(path2).catch((e: Error) => {
            this.error(`Error generating AsyncAPI docs. {Details: ${e.stack}}`);
        });

        this.log(`AsyncAPI docs generated.`);
    }

    public createServer(): void {
        if (Config.DOCS.ENABLED) {
            this.appDocs.get('/', (req, res) => {
                res.redirect('/api-docs');
            });

            this.appDocs.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
            this.appDocs.use('/live', express.static('./asyncapi'));
            this.appDocs.listen(Config.DOCS.PORT);
        }

        this.log(`Docs listening on port ${Config.DOCS.PORT}.`);
    }

    public async init(): Promise<void> {
        await this.generateAsyncApi();

        this.createServer();
    }
}

await new Docs().init();
