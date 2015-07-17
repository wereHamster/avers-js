var gulp       = require('gulp')
  , ts         = require('gulp-typescript')
  , tslint     = require('gulp-tslint')
  , babel      = require('gulp-babel')
  , browserify = require('gulp-browserify')
  ;


var aversLibrary = ts.createProject({
    typescript: require('typescript'),
    target: 'ES6',
    rootDir: "src/",
    outDir: "dist/",
    declarationFiles: true
});


gulp.task('compile', function() {
    var project = gulp.src(['src/**/*.ts']).pipe(ts(aversLibrary));
    return project.js.pipe(babel()).pipe(gulp.dest('dist/'));
});

gulp.task('lint', function() {
    gulp.src(['src/**/*.ts'])
        .pipe(tslint())
        .pipe(tslint.report('verbose'));
});

gulp.task('build', ['compile'], function() {
    return gulp.src('dist/avers.js')
        .pipe(browserify({ paths: ['dist'], standalone: 'Avers' }))
        .pipe(gulp.dest('.'));
});

gulp.task('test', ['compile'], function() {
    return gulp.src('dist/test.js')
        .pipe(browserify({ paths: ['dist'], exclude: ['chai'] }))
        .pipe(gulp.dest('.'));
})

gulp.task('watch', ['build'], function() {
    gulp.watch(['src/**/*.ts'], ['lint', 'build', 'test']);
});

gulp.task('default', ['build']);
