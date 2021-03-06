
var UglifyJS = require('uglify-js');
var babel = require('@babel/core');

function replaceBOM(text) {
    return text.replace(/^\uFEFF/i, '');
}

exports.minify = function minify(code, mangle_names) {
    code = replaceBOM(code).replace(/\/\/<--debug[\s\S]+?\/\/debug-->/img, '');

    var result = UglifyJS.minify(code, {
        compress: {
            sequences: true, // join consecutive statemets with the “comma operator”
            properties: true, // optimize property access: a["foo"] → a.foo
            dead_code: true, // discard unreachable code
            drop_debugger: true, // discard “debugger” statements
            unsafe: false, // some unsafe optimizations (see below)
            conditionals: true, // optimize if-s and conditional expressions
            comparisons: true, // optimize comparisons
            evaluate: true, // evaluate constant expressions
            booleans: true, // optimize boolean expressions
            loops: true, // optimize loops
            unused: true, // drop unused variables/functions
            hoist_funs: true, // hoist function declarations
            hoist_vars: false, // hoist variable declarations
            if_return: true, // optimize if-s followed by return/continue
            join_vars: true, // join var declarations
            side_effects: true, // drop side-effect-free statements
            global_defs: {}
        }
    });
    if (result.error) {
        throw new Error(result.error);
    }
    return result.code;
};


exports.toES5 = function toES5(script) {
    script = babel.transformSync(script, {
        presets: ['react-app'],
        filename: 'tmp.js',
        plugins: [
            ["@babel/plugin-proposal-decorators",
                {
                    "legacy": true
                }]
        ],
        babelrc: false,
        code: true,
        configFile: false,
    });
    return script.code;
};