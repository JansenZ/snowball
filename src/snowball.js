import _React from 'react';
import _ReactDOM from 'react-dom';
import * as _app from './app';
import * as _components from './components';
import * as _graphics from './graphics';
import * as _widget from './widget';
import * as _nativeSdk from './native-sdk';
import * as util from './utils';
import * as env from './env';

export const $ = util.$;
export const resource = _app.resource;

export {
    env,
    util,
    _React,
    _ReactDOM,
    _app,
    _components,
    _graphics,
    _widget,
    _nativeSdk
};

export * from "./vm";
export { default as stream, StreamUtils } from './core/stream';
export * from "./core/event";