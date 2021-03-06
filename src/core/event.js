import { isPlainObject } from "../utils";

const symbolEventEmitter = Symbol.for('snowball#EventEmitter');
const symbolEmitter = Symbol.for('snowball#Emitter');

function returnFalse() {
    return false;
}

function returnTrue() {
    return true;
}

export function Event(type, props) {
    props && Object.assign(this, props);
    this.type = type;

    return this;
}

export default Event;

Event.prototype = {
    isDefaultPrevented: returnFalse,

    isPropagationStopped: returnFalse,

    preventDefault: function () {
        this.isDefaultPrevented = returnTrue;
    },

    stopPropagation: function () {
        this.isPropagationStopped = returnTrue;
    }
};

const EventEmitterProto = {
    [symbolEventEmitter]: true,

    on(names, callback) {
        if (!callback || !names) return;

        var events = this.__events || (this.__events = {});

        names.split(/\s+/).forEach((name) => {
            if (name) {
                var type = name.toLowerCase();
                var fns = events[type] || (events[type] = []);
                fns.push(callback);
            }
        });
        return this;
    },

    untilTrue(name, callback) {
        if (!callback) return this;

        var self = this;
        async function once() {
            var res = callback.apply(self, arguments);
            if (res && typeof res.then === 'function') {
                res = await res;
            }
            if (res === true)
                self.off(name, once);
            return res;
        }
        once._cb = callback;

        return this.on(name, once);
    },

    once(name, callback) {
        if (!callback) return this;

        var self = this;
        function once() {
            self.off(name, once);
            return callback.apply(self, arguments);
        }
        once._cb = callback;

        return this.on(name, once);
    },

    off(names, callback) {
        if (!this.__events) return this;

        if (!names) {
            this.__events = null;
        } else if (!callback) {
            names.split(/\s+/).forEach((name) => {
                if (name) {
                    delete this.__events[name.toLowerCase()];
                }
            });
        } else {
            names.split(/\s+/).forEach((name) => {
                if (name) {
                    var fns = this.__events[name.toLowerCase()];
                    if (fns) {
                        for (var i = fns.length - 1; i >= 0; i--) {
                            if (fns[i] === callback || fns[i]._cb === callback) {
                                fns.splice(i, 1);
                                break;
                            }
                        }
                    }
                }
            });
        }

        return this;
    },

    trigger(e, ...args) {
        if (!this.__events || !e) return this;

        var fns;
        var events = this.__events;
        var name = (typeof e === 'string' ? e : e.type).toLowerCase();
        var dotIndex;
        var len;

        while ((dotIndex = name.lastIndexOf('.')) != -1) {
            events[name] && (fns = (fns || []).concat(events[name]));
            name = name.slice(0, dotIndex);
        }
        events[name] && (fns = (fns || []).concat(events[name]));

        if (fns && (len = fns.length)) {
            var i = -1;
            var stoped;

            if (typeof e === 'string') e = new Event(e);
            else if (!(e instanceof Event)) e = new Event(e.type, e);

            if (!e.target) e.target = this;

            e.args = args;
            args.unshift(e);

            while (++i < len) {
                if ((stoped = e.isPropagationStopped()) || false === fns[i].apply(this, args)) {
                    if (!stoped) {
                        e.stopPropagation();
                        e.preventDefault();
                    }
                    break;
                }
            }
        }
        return this;
    },

    emitter(type) {
        return (...args) => {
            this.trigger(type, ...args);
        };
    }
};

EventEmitterProto.emit = EventEmitterProto.trigger;

export function EventEmitter() {
}
EventEmitter.prototype = EventEmitterProto;

export function eventMixin(fn, ext) {
    Object.assign(typeof fn == 'function' ? fn.prototype : fn, EventEmitterProto, ext);
    return fn;
}

function createEmitterFn(extend) {
    return (init) => {
        let funcs = [];

        const emitter = (fn) => typeof fn === 'function'
            ? emitter.on(fn)
            : emitter.emit(fn);

        emitter[symbolEmitter] = true;

        Object.assign(emitter, {
            on(fn) {
                funcs.push(fn);
                return () => emitter.off(fn);
            },
            once(fn) {
                const once = (state, e) => {
                    dispose();
                    fn(state, e);
                };
                const dispose = emitter.on(once);
                return dispose;
            },
            untilTrue(fn) {
                const dispose = emitter.on(async (state, e) => {
                    let result = fn(state, e);
                    if (result && typeof result.then === 'function') {
                        result = await result;
                    }
                    if (result === true) {
                        dispose();
                    }
                });
                return dispose;
            },
            reset() {
                funcs = init ? [init] : [];
            },
            off(fn) {
                if (fn) {
                    const index = funcs.indexOf(fn);
                    if (index !== -1) {
                        funcs.splice(index, 1);
                    }
                } else {
                    funcs = [];
                }
                return emitter;
            }
        }, extend(funcs));

        if (typeof init === 'function') {
            emitter(init);
        }

        return emitter;
    };
}

function eventFromState(state) {
    return new Event(isPlainObject(state) && state.type && typeof state.type == 'string' ? state.type : 'do');
}

const createEmitter = createEmitterFn((funcs) => {
    return {
        emit(state) {
            const event = eventFromState(state);
            funcs.every(nextFunc => {
                nextFunc(state, event);
                return !event.isPropagationStopped() && !event.isDefaultPrevented();
            });
            return event;
        }
    };
});

const createAsyncEmitter = createEmitterFn((funcs) => {
    return {
        emit: async (state) => {
            const event = eventFromState(state);
            for (let i = 0; i < funcs.length; i++) {
                await funcs[i](state, event);
                if (event.isPropagationStopped() || event.isDefaultPrevented()) {
                    break;
                }
            }
            return event;
        }
    };
});

function createEventDelegate(eventEmitter, type, listener) {
    let delegate;

    if (typeof eventEmitter === 'function') {
        let despose;
        const on = () => {
            despose && despose();
            despose = eventEmitter();
            return delegate;
        };
        delegate = {
            on,
            off() {
                despose && despose();
                return delegate;
            }
        };
        on();
    } else {
        eventEmitter.on(type, listener);
        delegate = {
            emit(...args) {
                eventEmitter.trigger(type, ...args);
                return delegate;
            },
            on() {
                delegate.off();
                eventEmitter.on(type, listener);
                return delegate;
            },
            off() {
                eventEmitter.off(type, listener);
                return delegate;
            },
        };
    }
    return delegate;
}

export const Emitter = {
    create: createEmitter,
    async: createAsyncEmitter,
    delegate: createEventDelegate,
};


// var event = new EventEmitter();

// var fn = () => console.log(1);
// event.on('asdf asdf2', fn);
// event.trigger('asdf.bbb');
// event.off('asdf', fn);

// event.untilTrue('asdf', () => {
//     console.log('untilTrue');
//     return true;
// });
// event.trigger('asdf.bbb');

// console.log(event);
