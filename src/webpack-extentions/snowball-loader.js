// var loaderUtils = require('loader-utils');

function replaceImport(source, _package, replaceWith) {
    const getPackageName = typeof replaceWith === 'function'
        ? replaceWith
        : function (packageName) {
            return replaceWith;
        };

    const getImportExp = function (varName, packageName) {
        if (!varName) return '';
        return "var " + varName + "=" + getPackageName(packageName) + ";";
    };

    _package = '(' + _package + ')';

    source = source
        .replace(new RegExp("\\bimport\\s+\\*\\s+as\\s+([\\w$]+)\\s+from\\s+(\"|')" + _package + "\\2\\s*;?", 'mg'), function (match, name, q, packageName) {
            return getImportExp(name, packageName);
        })
        .replace(new RegExp("\\bimport\\s+([\\w$]+)(?:\\s*,\\s*(\\{[^}]+\\}))?\\s+from\\s+(\"|')" + _package + "\\3\\s*;?", "mg"), function (match, name, names, q, packageName) {
            return getImportExp(name, packageName)
                + getImportExp(names, packageName);
        })
        .replace(new RegExp("\\bimport\\s+(\\{[^}]+\\})(?:\\s*,\\s*([\\w$]+))?\\s+from\\s+(\"|')" + _package + "\\3\\s*;?", "mg"), function (match, names, name, q, packageName) {
            return getImportExp(names, packageName)
                + getImportExp(name, packageName);
        });

    source = source.replace(new RegExp("\\b(?:var|const|let|,)\\s+([\\w$]+)\\s*=\\s*require\\(\\s*(\"|')" + _package + "\\2\\s*\\)\\s*;?", 'mg'), function (match, name, q, packageName) {
        return getImportExp(name, packageName);
    });

    return source;
}

module.exports = function (source, inputSourceMap) {
    this.cacheable();

    // var options = loaderUtils.getLoaderConfig(this);
    // console.log(options);

    var content = replaceImport(source, "snowball", "window.Snowball");
    content = replaceImport(content, "snowball/components", "window.Snowball.components");
    content = replaceImport(content, "snowball/widget", "window.Snowball.widget");
    content = replaceImport(content, "snowball/graphics", "window.Snowball.graphics");
    content = replaceImport(content, "snowball/.+", (packageName) => "{};throw new Error('unavaliable import `" + packageName + "`!!')");
    content = replaceImport(content, "react", "window.Snowball.React");
    content = replaceImport(content, "react-dom", "window.Snowball.ReactDOM");
    this.callback(null, content, inputSourceMap);
};