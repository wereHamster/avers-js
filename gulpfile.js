var gulp       = require('gulp')
  , ts         = require('gulp-typescript')
  , tslint     = require('gulp-tslint')
  , babel      = require('gulp-babel')
  , mocha      = require('gulp-mocha')
  , browserify = require('gulp-browserify')
  , merge      = require('merge2');


var aversLibrary = ts.createProject('tsconfig.json');
var files        = require('./tsconfig.json').files;


gulp.task('lint', function() {
    gulp.src(files)
        .pipe(tslint())
        .pipe(tslint.report('verbose'));
});

gulp.task('build', function() {
    var project = gulp.src(files).pipe(ts(aversLibrary));

    return merge([
        project.dts.pipe(gulp.dest('dist/')),
        project.js.pipe(babel({ presets: ['es2015'] })).pipe(gulp.dest('dist/'))
    ]);
});

gulp.task('test', ['build'], function() {
    return gulp
        .src('dist/test/avers.test.js', { read: false })
        .pipe(mocha());
});

gulp.task('test:browser', ['build'], function() {
    return gulp.src('dist/test/avers.test.js')
        .pipe(browserify({ paths: ['dist'] }))
        .pipe(gulp.dest('.'));
})

gulp.task('watch', ['build'], function() {
    gulp.watch(files, ['lint', 'build', 'test']);
});

gulp.task('default', ['build']);
