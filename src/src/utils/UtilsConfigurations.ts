export class UtilsConfigurations {
    public static WORKER_OPTIONS: any = {
        argv: [],
        execArgv: [],
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 7,
            maxYoungGenerationSizeMb: 1024 * 3,
            stackSizeMb: 256,
        },
    };
}
