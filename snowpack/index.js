var fs = require('fs');
var fsc = require('./fs');
var path = require('path');
var razor = require('./razor');
var _ = require('lodash');
var Tools = require('./tools');
var sass = require('node-sass');
var sprity = require('./sprity');

var Util = require('util');
var util = require('./util');
_.extend(Util, util);

var httpProxy = require('./http-proxy');

var getDefinedId = util.joinPath;
var transformSnowballJS = Tools.transformSnowballJS;

// if (__dirname != process.cwd()) process.chdir(__dirname);

function absolutePath(...paths) {
    if (paths[0][0] !== '/') paths.unshift(process.cwd());
    return path.join(...paths);
}

function trimPath(path) {
    return path.replace(/(^\/)|(\/$)/g, '');
}

function combineRouters(config) {
    var result = {};
    config.projects.forEach(function (project) {
        for (var key in project.route) {
            var router = project.route[key];
            var regexStr = (trimPath(project.root) + '/' + trimPath(key)).replace(/^\.\//, '');

            if (typeof router == 'string') {
                router = {
                    controller: router,
                    template: router
                }
            } else {
                router = _.extend({}, router);
            }
            _.extend(router, {
                controller: getDefinedId("views", router.controller),
                template: getDefinedId("template", router.template)
            });

            router.root = project.root;

            result[regexStr] = router;
        }
    });

    return result;
}

exports.loadConfig = function (callback) {
    return new Promise(function (resolve) {
        var exec = require('child_process').exec;

        exec('ifconfig', (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            var matchIp = stdout.match(/\sen0\:[\s\S]+?\sinet\s(\d+\.\d+\.\d+\.\d+)/);

            resolve(matchIp ? matchIp[1] : '127.0.0.1');
        });
    }).then(function (ip) {
        var map = {
            ip: ip
        }
        console.log(ip);

        return new Promise(function (resolve) {
            fs.readFile(absolutePath('./global.json'), {
                encoding: 'utf-8'
            }, function (err, globalStr) {
                globalStr = globalStr.replace(/\$\{(\w+)\}/g, function (match, key) {
                    return (key in map) ? map[key] : match;
                })

                var globalConfig = JSON.parse(globalStr);
                globalConfig.routes = {};

                resolve(globalConfig);
            })
        });
    }).then(function (globalConfig) {
        return Promise.all(globalConfig.projects.map(function (project, i) {
            return new Promise(function (resolve) {
                fs.readFile(absolutePath(project, 'config.json'), {
                    encoding: 'utf-8'
                }, function (err, data) {
                    var config = JSON.parse(data);
                    config.root = project;

                    resolve(config);
                });
            });
        })).then(function (results) {
            globalConfig.projects = results;

            callback(globalConfig);

            return globalConfig;
        })
    })
}

function createIndex(config, callback) {
    fs.readFile(absolutePath('./root.html'), {
        encoding: 'utf-8'
    }, function (err, html) {
        var T = razor.nodeFn(Tools.removeBOMHeader(html));
        var rimg = /url\(("|'|)([^\)]+)\1\)/g;

        Promise.all(config.css.map(function (cssPath, i) {
            return new Promise(function (resolve) {
                fs.readFile(absolutePath(cssPath), {
                    encoding: 'utf-8'
                }, function (err, style) {
                    resolve(Tools.removeBOMHeader(style));
                });
            });
        })).then(function (styles) {
            var style = styles.join('').replace(rimg, function (r0, r1, r2) {
                return /^data\:image\//.test(r2) ? r0 : ("url(images/" + r2 + ")");
            });

            var result = T.html(_.extend({}, config, {
                style: "<style>" + style + "</style>",
                routes: combineRouters(config)
            }));

            callback(null, result);
        });
    });
}

exports.createIndex = createIndex;

exports.startWebServer = function (config) {
    var express = require('express');
    var app = express();

    config.resourceMapping = {};

    app.use('/dest', express.static(absolutePath(config.dest)));

    if (config.static) {
        Object.keys(config.static).forEach(function (key) {
            app.use(key, express.static(absolutePath(config.static[key])));
        });
    }

    config.images.forEach(function (imageDir) {
        app.use('/images', express.static(absolutePath(imageDir)));
    });

    app.use('/dest', express.static(absolutePath(config.dest)));


    app.get('/', function (req, res) {
        createIndex(config, function (err, html) {
            res.send(html);
        });
    });

    config.projects.forEach(function (project) {
        var root = trimPath(project.root);
        var requires = [];

        for (var key in project.css) {
            project.css[key] && project.css[key].forEach(function (file) {
                requires.push(getDefinedId(project.root, file));
            });
        }

        var sprite = project.sprite;
        if (sprite) {
            sprite.out = absolutePath(root, sprite.out);
            sprite.src = absolutePath(root, sprite.src);
            sprite.template = absolutePath(root, sprite.template);
            sprity.create(sprite);
        }

        app.all((root && root != '.' ? "/" + root : '') + '/template/[\\S\\s]+.js', function (req, res, next) {
            var filePath = req.url.replace(/\.js(\?.*){0,1}$/, '');

            fsc.readFirstExistentFile(['.' + filePath + '.html', '.' + filePath + '.cshtml', '.' + filePath + '.tpl'], function (err, text) {
                if (err) {
                    next();
                    return;
                }
                text = Tools.removeBOMHeader(text);
                text = razor.web(text);
                res.set('Content-Type', "text/javascript; charset=utf-8");
                res.send(text);
            });
        });

        app.all((root && root != '.' ? "/" + root : '') + '/views/[\\S\\s]+.js', function (req, res, next) {
            var filePath = "." + req.url;

            fsc.readFirstExistentFile([filePath, filePath + 'x'], function (err, text) {
                if (err) {
                    next();
                    return;
                }
                text = Tools.removeBOMHeader(text);

                text = transformSnowballJS(text);
                text = Tools.setModuleDefine(filePath.replace(/(^\/)|(\.js$)/g, ''), text, requires);

                res.set('Content-Type', "text/javascript; charset=utf-8");
                res.send(text);
            });
        });
    });

    app.all('*.js', function (req, res, next) {
        var filePath = req.url;
        var isRazorTpl = /\.(html|tpl|cshtml)\.js$/.test(filePath);

        fsc.readFirstExistentFile(
            _.map(config.projects, 'root')
                .concat(config.path)
                .map((projPath) => absolutePath(projPath)),
            isRazorTpl ? [filePath.replace(/\.js$/, '')] : [filePath, filePath + 'x'],
            function (err, text) {
                console.log(filePath);

                if (err) {
                    next();
                    return;
                }

                text = Tools.removeBOMHeader(text);
                if (isRazorTpl) text = razor.web(text);
                text = transformSnowballJS(text);

                res.set('Content-Type', "text/javascript; charset=utf-8");
                res.send(text);
            }
        );
    });

    config.projects.forEach(function (project) {
        app.use(express.static(absolutePath(project.root)));
    });

    config.path.forEach(function (searchPath) {
        app.use(express.static(absolutePath(searchPath)));
    });

    app.all('*.css', function (req, res, next) {
        fsc.firstExistentFile(
            _.map(config.projects, 'root')
                .concat(config.path)
                .map(projPath => absolutePath(projPath)),
            [req.params[0] + '.scss'],
            function (fileName) {
                if (!fileName) {
                    next();
                    return;
                }

                sass.render({
                    file: fileName
                }, function (err, result) {
                    if (err) {
                        console.log(err);
                        next();
                    } else {
                        res.set('Content-Type', "text/css; charset=utf-8");

                        Tools.postCSSForDevelopment(result.css.toString()).then(function (result) {
                            res.send(result.css);
                        });
                    }
                });
            }
        );
    });

    for (var key in config.proxy) {
        var proxy = config.proxy[key].split(':');
        app.all(key, httpProxy(proxy[0], proxy[1] ? parseInt(proxy[1]) : 80));
    }

    console.log("start with", config.port, process.argv);

    app.listen(config.port);
}

var argv = process.argv;
var args = {};

for (var i = 2, arg, length = argv.length; i < length; i++) {
    arg = argv[i];

    arg.replace(/--([^=]+)(?:\=(\S+)){0,1}/, function (match, key, value) {
        args[key] = value == undefined ? true : (/^(true|false|-?\d+)$/.test(value) ? eval(value) : value);
        return '';
    });
}

//打包
if (args.build) {
    exports.loadConfig(function (config) {
        console.log("start:", util.formatDate(new Date()));

        _.extend(config, config.env[args.build === true ? 'production' : args.build], {
            debug: false
        });

        var absoluteBaseDir = absolutePath('./');
        var absoluteDestDir = absolutePath(config.dest);

        var tools = new Tools({
            baseDir: absoluteBaseDir,
            destDir: absoluteDestDir
        });

        //打包框架
        tools.combine({
            "snowball": config.framework
        });

        if (config.copy) {
            Object.keys(config.copy).forEach(function (key) {
                fsc.copy(config.copy[key], absolutePath(config.dest, key), function () {
                });
            })
        }

        //合并js
        config.resourceMapping = tools.combine(config.js);

        //生成首页
        createIndex(config, function (err, html) {
            Tools.minifyHTML(html).then(function (res) {
                Tools.save(path.join(absoluteDestDir, 'index.html'), res);
            })
        });

        //打包业务代码
        config.projects.forEach(function (project) {
            var codes = '';
            var requires = [];
            var excludes = [];

            var pachJs = function (key, fileList, resourceMapping) {
                var ids;
                if (!_.isArray(fileList)) {
                    ids = _.keys(fileList);
                    fileList = _.map(fileList, function (value, id) {
                        return value || id;
                    });
                }

                Promise.all(fileList.map(function (file, i) {
                    var isRazorTpl = /\.(html|tpl|cshtml)$/.test(file);

                    return new Promise(function (resolve) {
                        fsc.readFirstExistentFile([project.root], isRazorTpl ? [file] : [file + '.js', file + '.jsx'], function (err, text, fileName) {
                            var jsId = ids ? ids[i] : getDefinedId(project.root, file);

                            resourceMapping.push(jsId);

                            if (isRazorTpl) text = razor.web(text);
                            text = transformSnowballJS(text);
                            text = Tools.minifyJS(Tools.setModuleDefine(jsId, text));

                            resolve(text);
                        });
                    })
                })).then(function (results) {
                    Tools.save(path.join(absoluteDestDir, project.root, key + '.js'), results.join(''));
                });
            }

            for (var key in project.js) {
                var combinedJs = getDefinedId(project.root, key);
                var resourceMapping = config.resourceMapping[combinedJs] = [];
                var jsMap = project.js[key];
                var tmp;

                if (typeof jsMap == 'string') {
                    (tmp = {})[key] = jsMap;
                    jsMap = tmp;
                }

                //打包项目引用js
                pachJs(key, jsMap, resourceMapping);
            }

            var packCss = function (key, fileList) {
                Promise.all(fileList.map(function (file) {
                    return new Promise(function (resolve) {
                        fsc.firstExistentFile([absolutePath(project.root, file), absolutePath(project.root, file).replace(/\.css$/, '.scss')], function (file) {
                            if (/\.css$/.test(file)) {
                                fs.readFile(file, 'utf-8', function (err, text) {
                                    Tools.postCSS(text).then(function (result) {
                                        resolve(result.css);
                                    });
                                });
                            } else {
                                sass.render({
                                    file: file,
                                    outputStyle: 'compressed'
                                }, function (err, result) {
                                    Tools.postCSS(result.css.toString()).then(function (result) {
                                        resolve(result.css);
                                    });
                                });
                            }
                        });
                    });

                })).then(function (results) {
                    Tools.save(path.join(absoluteDestDir, project.root, key), results.join(''));
                });
            }

            for (var key in project.css) {
                requires.push(getDefinedId(project.root, key));

                if (project.css[key] && project.css[key].length) {
                    //打包项目引用css
                    packCss(key, project.css[key]);
                }
            }

            var promise = Promise.resolve();

            //打包template和controller
            var contains = [];

            for (var key in project.route) {
                (function (router) {
                    var controller;
                    var template;

                    if (typeof router == 'string') {
                        controller = template = router;

                    } else {
                        controller = router.controller;
                        template = router.template;
                    }

                    controller = getDefinedId(project.root, 'views', controller);
                    template = getDefinedId(project.root, 'template', template);

                    var controllerPath = path.join(absoluteBaseDir, controller);
                    var templatePath = path.join(absoluteBaseDir, template);

                    excludes = excludes.concat(Object.keys(config.framework))
                        .concat(['animation', '$', 'zepto', 'activity']);

                    promise = promise.then(function () {

                        return new Promise(function (resolve) {

                            //打包模版
                            fsc.readFirstExistentFile([templatePath + '.html', templatePath + '.cshtml', templatePath + '.tpl'], function (err, text, fileName) {
                                if (!err && contains.indexOf(fileName) == -1) {
                                    contains.push(fileName);
                                    text = razor.web(text);
                                    text = Tools.minifyJS(Tools.setModuleDefine(template, text));
                                    codes += text;
                                }
                                console.log("打包模版", fileName);

                                resolve();
                            });
                        })
                    }).then(function () {
                        return new Promise(function (resolve) {

                            //打包控制器
                            fsc.readFirstExistentFile([controllerPath + '.js', controllerPath + '.jsx'], function (err, text, fileName) {
                                if (!err && contains.indexOf(fileName) == -1) {
                                    text = transformSnowballJS(text);
                                    text = Tools.minifyJS(Tools.setModuleDefine(controller, text, requires, excludes));
                                    codes += text;
                                }

                                console.log("打包控制器", fileName);

                                resolve();
                            });
                        })
                    });
                })(project.route[key]);
            }

            //保存合并后的业务代码
            promise.then(function () {
                console.log('保存合并后的业务代码');

                Tools.save(path.join(absoluteDestDir, project.root, 'controller.js'), codes);
            });
        });

        //复制图片资源
        var resouceExt = '*.(jpg|gif|png|eot|svg|ttf|woff)';

        Promise.all(config.images.map(function (imgDir, i) {
            return new Promise(function (resolve, reject) {
                fsc.copy(path.join(absoluteBaseDir, imgDir), absolutePath(config.dest, 'images'), resouceExt, function (err, result) {
                    resolve(result);
                });
            });
        })).then(function () {
            config.projects.forEach(function (proj) {
                if (proj.images) {
                    proj.images.forEach(function (imgDir) {
                        fsc.copy(absolutePath(proj.root, imgDir), absolutePath(config.dest, proj.root, 'images'), resouceExt, function (err, result) {

                        });
                    });
                }
            });
        }).then(function () {
            console.log('copy resources success');
        });
    });

} else {
    exports.loadConfig(function (config) {
        exports.startWebServer(config);
    });
}