import gulpESLintNew from 'gulp-eslint-new';
import gulp from 'gulp';
import gulpcache from 'gulp-cached';

import gulpClean from 'gulp-clean';
import logger from 'gulp-logger';
import ts from 'gulp-typescript';

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});

const tsProject = ts.createProject('tsconfig.json');

function onError(e) {
    console.log('Errored', e);
}

function buildESM() {
    return tsProject
        .src()
        .on('error', onError)
        .pipe(gulpcache('ts-esm'))
        .pipe(
            logger({
                before: 'Starting...',
                after: 'Project compiled!',
                extname: '.js',
                showChange: true,
            }),
        )
        .pipe(gulpESLintNew())
        .pipe(gulpESLintNew.format())
        .pipe(tsProject())
        .pipe(gulp.dest('build'));
}

export async function clean() {
    return gulp.src('./build/src', { read: false }).pipe(gulpClean());
}

function buildYaml() {
    return gulp
        .src('./src/**/*.yaml')
        .pipe(
            logger({
                before: 'Starting...',
                after: 'Compiled yaml.',
                extname: '.yaml',
                showChange: true,
            }),
        )
        .pipe(gulpcache('yaml'))
        .pipe(gulp.dest('./build/'));
}

function buildProto() {
    return gulp
        .src('./src/**/*.proto')
        .pipe(
            logger({
                before: 'Starting...',
                after: 'Compiled protobuf.',
                extname: '.proto',
                showChange: true,
            }),
        )
        .pipe(gulpcache('protobuf'))
        .pipe(gulp.dest('./build/'));
}

function buildConfig() {
    return gulp
        .src('./src/config/*.conf')
        .pipe(
            logger({
                before: 'Starting...',
                after: 'Compiled conf.',
                extname: '.conf',
                showChange: true,
            }),
        )
        .pipe(gulpcache('config'))
        .pipe(gulp.dest('./build/config'));
}

export const optionals = gulp.parallel(buildYaml, buildProto, buildConfig);
export const build = gulp.series(buildESM, optionals);
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
