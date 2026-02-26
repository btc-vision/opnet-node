import gulpESLintNew from 'gulp-eslint-new';
import gulp from 'gulp';
import gulpcache from 'gulp-cached';
import gulpClean from 'gulp-clean';
import { Logger } from '@btc-vision/logger';
import ts from 'gulp-typescript';
import { Transform } from 'stream';

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});

class GulpLogger extends Logger {
    moduleName = 'Compiler';
    logColor = '#4f77f9';
}

const logger = new GulpLogger();
const tsProject = ts.createProject('tsconfig.json');

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

function buildESM() {
    return tsProject
        .src()
        .on('error', onError)
        .pipe(gulpcache())
        .pipe(logPipe('Starting...', 'Project compiled!', '.js'))
        .pipe(gulpESLintNew())
        .pipe(gulpESLintNew.format())
        .pipe(tsProject())
        .pipe(gulp.dest('build'));
}

export function clean() {
    return gulp
        .src('./build/src', { read: false, allowEmpty: true })
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
    gulp.watch(['src/**/*.ts', 'src/**/*.js'], gulp.series(buildESM));
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
