import { Component } from "react";
import inject from "./inject";
import { Reaction } from "../../snowball/vm";

const ReactionProperty = Symbol('ReactionProperty');

export default function observer(arg1) {
    if (typeof arg1 !== 'function') {
        let injector;
        if (Array.isArray(arg1)) {
            injector = inject.apply(null, arg1);
        } else {
            injector = inject.apply(null, arguments);
        }
        return (componentClass) => {
            return injector(observer(componentClass));
        };
    }

    const componentClass = arg1;

    if (!componentClass.prototype || !componentClass.prototype.render) {
        return observer(class extends Component {
            render() {
                return componentClass.call(this, this.props, this.context);
            }
        });
    }

    const target = componentClass.prototype;
    const baseComponentWillUnmount = target.componentWillUnmount;
    const baseRender = target.render;

    target.componentWillUnmount = function () {
        this[ReactionProperty] && this[ReactionProperty].destroy();
        baseComponentWillUnmount && baseComponentWillUnmount();
    };

    target.render = function () {
        let isRenderingPending = false;

        const reaction = new Reaction(() => {
            if (!isRenderingPending) {
                isRenderingPending = true;
                Component.prototype.forceUpdate.call(this);
            }
        });

        function reactiveRender() {
            isRenderingPending = false;

            let root;
            reaction.track(() => {
                root = baseRender.call(this);
            });
            return root;
        }

        this[ReactionProperty] = reaction;
        this.render = reactiveRender;
        return reactiveRender.call(this);
    };
    return componentClass;
}