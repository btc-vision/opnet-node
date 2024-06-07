import { WorkerOptions } from 'worker_threads';

export class ThreadConfigurations {
    public static WORKER_OPTIONS: WorkerOptions = {
        argv: [],
        execArgv: [],
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 2,
            maxYoungGenerationSizeMb: 1024,
            stackSizeMb: 256,
        },
    };
}
