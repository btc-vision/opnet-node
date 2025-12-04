export interface BuildInfo {
    readonly version: string;
    readonly gitVersion: string;
    readonly modules: readonly string[];
    readonly allocator: string;
    readonly javascriptEngine: string;
    readonly sysInfo: string;
    readonly versionArray: readonly number[];
    readonly openssl: {
        readonly running: string;
        readonly compiled: string;
    };
    readonly buildEnvironment: {
        readonly distmod: string;
        readonly distarch: string;
        readonly cc: string;
        readonly ccflags: string;
        readonly cxx: string;
        readonly cxxflags: string;
        readonly linkflags: string;
        readonly target_arch: string;
        readonly target_os: string;
    };
    readonly bits: number;
    readonly debug: boolean;
    readonly maxBsonObjectSize: number;
    readonly storageEngines: readonly string[];
    readonly ok: number;
}
