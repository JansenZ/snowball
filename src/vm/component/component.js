/* eslint-disable max-statements */
import { compile } from "./compile";
import { createElement, syncRootChildElements, removeElement } from "./element";
import { render, invokeEvent } from "./render";
import { $, isFunction } from "../../utils";
import { nextTick } from "../methods/enqueueUpdate";
import { _isObservableClass } from "../reaction/initializer";
import { Model } from "../objects/Model";
import { asObservable } from "../observable";

const factories = {};

export function createComponent(tagName, props, ownComponent?) {
    if (!factories[tagName]) {
        throw new Error(tagName + ' is not register!');
    }
    return new factories[tagName](props, ownComponent);
}

export function isComponent(obj) {
    return obj && (obj instanceof Component || obj instanceof CustomComponent);
}

function nodeHandler(element, action) {
    const { rootElement } = this;
    const handle = () => {
        $(rootElement.firstNode)[action](element);
        syncRootChildElements(rootElement);
    };

    rootElement.firstNode
        ? handle()
        : nextTick(handle);

    return this;
}

function getAllRealNodes(element) {
    const { vnode } = element;
    if (vnode) {
        if (vnode.type == 'component') {
            return element.component.$el;
        } else if (vnode.type == 'root') {
            return element.childElements
                ? element.childElements.reduce((res, elem) => res.concat(getAllRealNodes(elem)), [])
                : [];
        } else {
            return element.node;
        }
    } else {
        return element;
    }
}

class Component {
    constructor(state, rootVNode, ownComponent?) {
        const $state = asObservable(state);
        this.$state = $state;
        this.state = state;

        $state.state.component = this;

        this.ownComponent = ownComponent || this;
        this._eventsDelegation = {};
        this.refs = {};

        const rootElement = this.rootElement = createElement(rootVNode);
        rootElement.component = this;
        rootElement.id = $state.state.id;
        rootElement.components = [];

        $state.on('destroy', () => {
            this.remove();
            this.rootElement.components.forEach((item) => {
                item.destroy();
            });
        });
    }

    $(selector) {
        const { $el } = this;
        return $el.find(selector).add($el.filter(selector));
    }

    get $el() {
        return $(getAllRealNodes(this.rootElement));
    }

    get lastNode() {
        return this.rootElement.lastNode;
    }

    _delegateEvents() {
        const events = Object.keys(this._eventsDelegation);

        if (events.length) {
            const nodes = getAllRealNodes(this.rootElement);
            if (nodes && nodes.length) {
                const eventFxMap = {
                    'transitionend': $.fx.transitionEnd,
                    'animationend': $.fx.animationEnd,
                };

                events.forEach((eventName) => {
                    nodes.forEach((el) => {
                        if (el.nodeType == 1 && !(el.boundEvents || (el.boundEvents = {}))[eventName]) {
                            el.boundEvents[eventName] = true;
                            const eventId = 'sn' + this.$state.state.id + '-on' + eventName;
                            const eventSelector = '[' + eventId + ']';
                            const handleEvent = (e) => {
                                invokeEvent(e.currentTarget.vElement, e.currentTarget.vElement.data, Number(e.currentTarget.getAttribute(eventId)), e);
                            };
                            const fxEventName = eventFxMap[eventName] || eventName;

                            $(el).on(fxEventName, eventSelector, handleEvent)
                                .filter(eventSelector)
                                .on(fxEventName, handleEvent);
                        }
                    });
                });
            }
        }

        if (this.ownComponent !== this && !this.ownComponent._rendering) {
            this.ownComponent._delegateEvents();
        }
    }

    appendTo(element) {
        return nodeHandler.call(this, element, 'appendTo');
    }

    prependTo(element) {
        return nodeHandler.call(this, element, 'prependTo');
    }

    before(element) {
        return nodeHandler.call(this, element, 'before');
    }

    after(element) {
        return nodeHandler.call(this, element, 'after');
    }

    insertAfter(element) {
        return nodeHandler.call(this, element, 'insertAfter');
    }

    insertBefore(element) {
        return nodeHandler.call(this, element, 'insertBefore');
    }

    remove() {
        const { rootElement } = this;
        const handle = () => {
            $(rootElement.firstNode).remove();
            const childElements = rootElement.childElements;
            if (childElements) {
                for (let i = 0; i < childElements.length; i++) {
                    removeElement(childElements[i]);
                }
            }
            $(rootElement.lastNode).remove();
        };

        rootElement.firstNode
            ? handle()
            : nextTick(handle);

        return this;
    }

    set(data) {
        this.$state.set(data);
        return this;
    }

    destroy() {
        this.$state.destroy();
    }

    render() {
        this.$state.render();
        return this;
    }
}

function componentRender() {
    const data = Object.create(this.state.data || null);
    data.$state = this;
    data.delegate = this.state.facade || this.state.delegate;

    const componentInstance = this.state.component;
    componentInstance.refs = {};
    componentInstance._eventsDelegation = {};
    componentInstance._rendering = true;

    render(componentInstance.rootElement, this, data);

    componentInstance._rendering = false;
    componentInstance._delegateEvents();
    this.state.renderedVersion = this.state.version;

    return componentInstance;
}

export function template(templateStr) {
    const rootVNode = compile(templateStr);
    return (state, delegate) => {
        state.render = componentRender;
        state.state.delegate = delegate;
        return new Component(state, rootVNode);
    };
}

function bindInitializer(State) {
    if (isFunction(State.prototype.initialize)) {
        const set = State.prototype.set;
        State.prototype.set = function (data) {
            this.set = set;
            this.initialize(data);
        };
    }
}

export function component({
    tagName,
    template
}) {
    const rootVNode = compile(template);

    return (State) => {
        if (_isObservableClass(State)) {
            State.Model = class extends Model {
            };
            State.Model.prototype.render = componentRender;
        } else {
            State.prototype.render = componentRender;
            bindInitializer(State);
        }

        const componentFactory = function (data, ownComponent?) {
            const state = new State(data);
            return new Component(state, rootVNode, ownComponent);
        };
        componentFactory.$$typeof = 'snowball#component';
        componentFactory.Class = State;

        registerFactory(tagName, componentFactory);

        return componentFactory;
    };
}

interface ICustumComponent {
    el: any;
    render(): any;
    set(): any;
}

interface CustumComponentConstructor {
    new(props: any): ICustumComponent;
}

class CustomComponent {
    constructor(component, ownComponent) {
        this.component = component;
        this.ownComponent = ownComponent;
    }

    $(selector) {
        const { $el } = this;
        return $el.find(selector).add($el.filter(selector));
    }

    get $el() {
        return this.component.$el || $(this.component.el);
    }

    get lastNode() {
        const els = this.$el;
        return els[els.length - 1];
    }

    set(data) {
        this.component.set(data);
    }

    render() {
        this.component.render && this.component.render();
    }

    destroy() {
    }
}

['appendTo', 'prependTo', 'before', 'after', 'insertAfter', 'insertBefore', 'remove'].forEach((name) => {
    CustomComponent.prototype[name] = function (node) {
        if (node && node.vElement && node.vElement.vnode.type === 'component') {
            switch (name) {
                case 'insertAfter':
                    node = node.vElement.lastNode;
                    break;
                case 'insertBefore':
                    node = node.vElement.firstNode;
                    break;
            }
        }
        this.$el[name](node);
    };
});

function registerFactory(tagName, componentFactory) {
    if (tagName) {
        if (factories[tagName]) {
            throw new Error('`' + tagName + '` is already registered!');
        }
        factories[tagName] = componentFactory;
    }
}

function customComponentFactory(CustomComponentCtor: CustumComponentConstructor) {
    bindInitializer(CustomComponentCtor);
    const componentFactory = function (props, ownComponent) {
        return new CustomComponent(new CustomComponentCtor(props, ownComponent), ownComponent);
    };
    componentFactory.$$typeof = 'snowball#customComponent';
    componentFactory.Class = CustomComponentCtor;
    return componentFactory;
}

export function customComponent(tagName) {
    return (CustomComponentCtor: CustumComponentConstructor) => {
        const componentFactory = customComponentFactory(CustomComponentCtor);
        registerFactory(tagName, componentFactory);
        return componentFactory;
    };
}

if (process.env.NODE_ENV === 'development') {
    setTimeout(() => {
        const { observable } = require("../../snowball");

        const data = observable({
            name: 1
        });
        const connect = template(`<div>{name}</div>`);
        const item = connect(data);

        const div = document.createElement('div');

        item.render();
        item.appendTo(div);

        console.assert(div.querySelector('div').innerHTML == '1', "html error:" + div.innerHTML);

        // test getAllRealNodes
        const nodes = getAllRealNodes(item.rootElement);
        console.assert(nodes.length == 1 && nodes[0].nodeName == 'DIV' && nodes[0].innerHTML == '1', 'getAllRealNodes error');

        data.set({ name: 2 })
            .nextTick(() => {
                console.assert(div.querySelector('div').innerHTML == 2, "html error:" + div.innerHTML);
            });
    });

    setTimeout(async () => {
        const { observable, nextTick } = require("../../snowball");

        let val,
            eq;

        @component({
            tagName: 'TestObj',
            template: `<div>{data.name}</div>`
        })
        class Test {
            @observable
            data = { name: 1 };
        }

        const test = new Test();

        await nextTick();
        console.assert(test.$el.html() == '1', 'el html must be `1`, now is `' + test.$el.html() + '`');

        test.state.data.withMutations(data => {
            data.set({
                name: 2
            });
        });

        await nextTick();
        console.assert(test.$el.html() == '2', 'el html must be `2`, now is `' + test.$el.html() + '`');

        @component({
            tagName: 'TestModel',
            template: `<div>{data.name}</div>`
        })
        class TestModel extends Model {
        }

        const testModel = new TestModel();
        testModel.set({
            data: {
                name: 1
            }
        });

        await nextTick();
        console.assert(testModel.$el.html() == '1', 'el html must be `1`, now is `' + testModel.$el.html() + '`');

        testModel.set({
            data: {
                name: 2
            }
        });
        await nextTick();
        console.assert(testModel.$el.html() == '2', 'el html must be `2`, now is `' + testModel.$el.html() + '`');

        @customComponent('CustomTest')
        class TestCustom {
            constructor() {
                this.$el = $('<div class="custom">CustomTest</div>');
            }

            set(data) {
                this.$el.html(data.name);
            }

            render() {
            }
        }

        const testCustom = new TestCustom();
        console.assert(testCustom.$el.html() == 'CustomTest', 'el html must be `CustomTest`, now is `' + testModel.$el.html() + '`');

        @component({
            tagName: 'ComplexModel',
            template: `
                <div ref="div">{data.name}</div>
                <ul>
                    <li ref="li" sn-for="item,i in list">
                        <span>{i}</span><p>{item.name}</p>
                        <div class="sub" ref="sub" sn-for="sub,j in list2">
                            <i>{i}</i>
                            <em>{j}</em>
                            <div ref="subitem" class="subitem">{sub.name}</div>
                        </div>
                        <div class="sublist" ref="sublist" sn-for="sub,j in item.list">
                            {i}{j}<div ref="sublistitem" class="sublistitem">{i}{j}{sub.name}</div>
                        </div>
                    </li>
                </ul>
                <CustomTest ref="custom" name="test"></CustomTest>
                <div ref="customWrap">{custom}</div>
                <div>end</div>
            `
        })
        class ComplexModel extends Model {
        }

        const complexModel = new ComplexModel({
            data: {
                name: 1
            },
            list: [{
                name: 'item 1',
                list: [{
                    name: 'sublist item1'
                }, {
                    name: 'sublist item2'
                }]
            }],
            list2: [{
                name: 'list2 item 1'
            }, {
                name: 'list2 item 2'
            }]
        });

        await nextTick();
        console.assert(complexModel.refs.div && complexModel.refs.div.innerHTML === '1', 'complexModel.refs.div.innerHTML must be `1`, now is `' + complexModel.refs.div && complexModel.refs.div.innerHTML + '`');

        val = complexModel.refs.li && complexModel.refs.li.length === 1
            && $(complexModel.refs.li).find('p')
                .html();
        console.assert(val == 'item 1', '$(complexModel.refs.li).find("p").html() must be `item 1`, now is `' + val + '`');

        val = complexModel.refs.customWrap.innerHTML;
        console.assert(val == '', 'complexModel.refs.customWrap.innerHTML must be ``, now is `' + val + '`');

        val = complexModel.refs.custom.$el.html();
        console.assert(val == 'test', 'complexModel.refs.custom.$el.html() must be `test`, now is `' + val + '`');

        val = complexModel.$('.custom').html();
        console.assert(val == 'test', 'complexModel.$(".custom").html() must be `test`, now is `' + val + '`');


        val = complexModel.$('.subitem').html();
        console.assert(val == 'list2 item 1', "complexModel.$('.subitem').html() must be `list2 item 1`, now is `" + val + '`');

        val = complexModel.$('.subitem').eq(1)
            .html();
        console.assert(val == 'list2 item 2', "complexModel.$('.subitem').eq(1).html() must be `list2 item 1`, now is `" + val + '`');

        console.assert(complexModel.refs.subitem[0] == complexModel.$('.subitem')[0]);
        console.assert(complexModel.refs.subitem[1] == complexModel.$('.subitem')[1]);

        val = complexModel.$('.sublist').html();
        console.assert(val == '00<div class="sublistitem">00sublist item1</div>', "complexModel.$('.sublist').html() must be `00<div class=\"sublistitem\">00sublist item1</div>`, now is `" + val + '`');

        val = complexModel.$('.sublist').eq(1)
            .html();
        console.assert(val == '01<div class="sublistitem">01sublist item2</div>', "complexModel.$('.sublist').eq(1).html() must be `01<div class=\"sublistitem\">01sublist item2</div>`, now is `" + val + '`');

        val = complexModel.$('.sublistitem').html();
        console.assert(val == '00sublist item1', "complexModel.$('.sublist').html() must be `00sublist item1`, now is `" + val + '`');

        val = complexModel.$('.sublistitem').eq(1)
            .html();
        console.assert(val == '01sublist item2', "complexModel.$('.sublist').eq(1).html() must be `01sublist item2`, now is `" + val + '`');

        // update list
        complexModel.state.collection('list')
            .add([{
                name: "item 2",
                list: [{
                    name: 'sublist2 item1'
                }]
            }]);

        await nextTick();

        val = complexModel.refs.li && complexModel.refs.li.length === 2
            && $(complexModel.refs.li).find('p')
                .last()
                .html();
        console.assert(val == 'item 2', '$(complexModel.refs.li).find("p").last().html() must be `item 2`, now is `' + val + '`');

        val = complexModel.refs.li && complexModel.refs.li.length === 2
            && $(complexModel.refs.li[1]).find('span')
                .html();
        console.assert(val == '1', '$(complexModel.refs.li[1]).find(\'span\') must be `1`, now is `' + val + '`');

        // subitem
        val = complexModel.$('.subitem').length;
        console.assert(val == 4, "complexModel.$('.subitem').length must be `4`, now is `" + val + '`');

        val = complexModel.$('.subitem').eq(3)
            .html();
        console.assert(val == 'list2 item 2', "complexModel.$('.subitem').eq(1).html() must be `list2 item 1`, now is `" + val + '`');

        val = complexModel.$('.sub em').eq(3)
            .html();
        console.assert(val == '1', "complexModel.$('.sub em').eq(3).html() must be `1`, now is `" + val + '`');

        val = complexModel.$('.sublist').eq(1)
            .html();
        console.assert(val == '01<div class="sublistitem">01sublist item2</div>', "complexModel.$('.sublist').eq(1).html() must be `01<div class=\"sublistitem\">01sublist item2</div>`, now is `" + val + '`');

        val = complexModel.$('.sublistitem').html();
        console.assert(val == '00sublist item1', "complexModel.$('.sublist').html() must be `00sublist item1`, now is `" + val + '`');

        val = complexModel.$('.sublistitem').eq(1)
            .html();
        console.assert(val == '01sublist item2', "complexModel.$('.sublist').eq(1).html() must be `01sublist item2`, now is `" + val + '`');

        val = complexModel.$('.sublist').eq(2)
            .html();
        eq = '10<div class="sublistitem">10sublist2 item1</div>';
        console.assert(val == eq, "complexModel.$('.sublist').eq(1).html() must be `" + eq + "`, now is `" + val + '`');

        // update custom children
        complexModel.state.set({
            custom: testCustom
        });
        await nextTick();

        val = complexModel.refs.customWrap.innerHTML;
        console.assert(val == '<div class="custom">CustomTest</div>', 'complexModel.refs.customWrap.innerHTML must be `<div class="custom">CustomTest</div>`, now is `' + val + '`');

        testCustom.set({
            name: 'custom'
        });
        val = complexModel.refs.customWrap.innerHTML;
        console.assert(val == '<div class="custom">custom</div>', 'complexModel.refs.customWrap.innerHTML must be `<div class="custom">custom</div>`, now is `' + val + '`');

        complexModel.state.set({
            custom: 'asdf'
        });
        await nextTick();

        val = complexModel.refs.customWrap.innerHTML;
        console.assert(val == 'asdf', 'complexModel.refs.customWrap.innerHTML must be ``, now is `' + val + '`');
    });

}