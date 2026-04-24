import gulpESLintNew from 'gulp-eslint-new';
import gulp from 'gulp';
import gulpcache from 'gulp-cached';
import gulpClean from 'gulp-clean';
import { Logger } from '@btc-vision/logger';
import { Transform } from 'stream';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const tsgoPkg = require.resolve('@typescript/native-preview/package.json');
const tsgoBin = path.join(path.dirname(tsgoPkg), 'bin', 'tsgo.js');

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});

class GulpLogger extends Logger {
    moduleName = 'Compiler';
    logColor = '#4f77f9';
}

const logger = new GulpLogger();

function onError(e) {
    logger.error(String(e));
}

function logPipe(before, after, extname) {
    let started = false;
    return new Transform({
        objectMode: true,
        transform(file, _enc, cb) {
            if (!started) {
                logger.log(before);
                started = true;
            }
            if (file.relative) {
                logger.log(`${file.relative}${extname ? ` -> ${extname}` : ''}`);
            }
            cb(null, file);
        },
        flush(cb) {
            logger.success(after);
            cb();
        },
    });
}

function lintSummary() {
    let fileCount = 0;
    let errorCount = 0;
    let warningCount = 0;
    let fixableErrorCount = 0;
    let fixableWarningCount = 0;
    return new Transform({
        objectMode: true,
        transform(file, _enc, cb) {
            fileCount += 1;
            const r = file.eslint;
            if (r) {
                errorCount += r.errorCount ?? 0;
                warningCount += r.warningCount ?? 0;
                fixableErrorCount += r.fixableErrorCount ?? 0;
                fixableWarningCount += r.fixableWarningCount ?? 0;
            }
            cb(null, file);
        },
        flush(cb) {
            const parts = [
                `${fileCount} file${fileCount === 1 ? '' : 's'} linted`,
                `${errorCount} error${errorCount === 1 ? '' : 's'}`,
                `${warningCount} warning${warningCount === 1 ? '' : 's'}`,
            ];
            if (fixableErrorCount || fixableWarningCount) {
                parts.push(`${fixableErrorCount + fixableWarningCount} auto-fixable`);
            }
            if (errorCount > 0) {
                logger.error(parts.join(' | '));
            } else if (warningCount > 0) {
                logger.warn(parts.join(' | '));
            } else {
                logger.success(parts.join(' | '));
            }
            cb();
        },
    });
}

function lintSources() {
    return gulp
        .src(['src/**/*.ts', 'src/**/*.js'])
        .on('error', onError)
        .pipe(logPipe('Linting...', 'Lint complete.', ''))
        .pipe(gulpESLintNew())
        .pipe(gulpESLintNew.format())
        .pipe(lintSummary());
}

// Route a tsgo line through GulpLogger at the right severity.
function emitTsgoLine(line) {
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!stripped) return;

    if (/\berror TS\d+:/.test(stripped)) {
        logger.error(stripped);
    } else if (/\bwarning TS\d+:/.test(stripped)) {
        logger.warn(stripped);
    } else if (stripped.startsWith('TSFILE:')) {
        logger.log(stripped.replace(/^TSFILE:\s*/, 'emit '));
    } else {
        logger.log(stripped);
    }
}

function spawnTsgo(extraArgs = []) {
    const args = [
        tsgoBin,
        '-p',
        'tsconfig.json',
        '--extendedDiagnostics',
        '--listEmittedFiles',
        '--pretty',
        'false',
        ...extraArgs,
    ];
    const child = spawn(process.execPath, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const stdoutReader = createInterface({ input: child.stdout });
    const stderrReader = createInterface({ input: child.stderr });
    stdoutReader.on('line', emitTsgoLine);
    stderrReader.on('line', emitTsgoLine);
    return child;
}

function compileTs(cb) {
    logger.log('Compiling with tsgo...');
    const started = Date.now();
    const child = spawnTsgo();
    child.on('error', (err) => {
        onError(err);
        cb(err);
    });
    child.on('exit', (code) => {
        const seconds = ((Date.now() - started) / 1000).toFixed(2);
        if (code === 0) {
            logger.success(`tsgo compiled project in ${seconds}s`);
            cb();
        } else {
            cb(new Error(`tsgo exited with code ${code} after ${seconds}s`));
        }
    });
}

let tsgoWatchChild = null;
function startTsgoWatch() {
    if (tsgoWatchChild) return;
    logger.log('Starting tsgo --watch...');
    tsgoWatchChild = spawnTsgo(['--watch']);
    tsgoWatchChild.on('exit', (code) => {
        tsgoWatchChild = null;
        if (code !== 0 && code !== null) {
            logger.error(`tsgo --watch exited with code ${code}`);
        }
    });
    const stop = () => {
        if (tsgoWatchChild) tsgoWatchChild.kill('SIGTERM');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.once('exit', stop);
}

const buildESM = gulp.series(lintSources, compileTs);

export function clean() {
    return gulp
        .src(['./build', './tsconfig.tsbuildinfo'], { read: false, allowEmpty: true })
        .pipe(gulpClean({ allowEmpty: true }));
}

function buildYaml() {
    return gulp
        .src('./src/**/*.yaml')
        .pipe(logPipe('Starting...', 'Compiled yaml.', '.yaml'))
        .pipe(gulpcache('yaml'))
        .pipe(gulp.dest('./build/'));
}

function buildProto() {
    return gulp
        .src('./src/**/*.proto')
        .pipe(logPipe('Starting...', 'Compiled protobuf.', '.proto'))
        .pipe(gulpcache('protobuf'))
        .pipe(gulp.dest('./build/'));
}

function buildConfig() {
    return gulp
        .src('./src/config/*.conf')
        .pipe(logPipe('Starting...', 'Compiled conf.', '.conf'))
        .pipe(gulpcache('config'))
        .pipe(gulp.dest('./build/config'));
}

export const optionals = gulp.parallel(buildYaml, buildProto, buildConfig);
export const build = gulp.series(clean, buildESM, optionals);
export default build;

export function watch() {
    startTsgoWatch();
    gulp.watch(['src/**/*.ts', 'src/**/*.js'], lintSources);
    gulp.watch(
        [
            'src/components/*.yaml',
            'src/**/*.yaml',
            'src/src/*.yaml',
            'src/*.proto',
            'src/**/**/*.proto',
            'src/**/*.proto',
            '*.proto',
            '*.yaml',
            '*.conf',
            'src/config/*.conf',
        ],
        optionals,
    );
}
