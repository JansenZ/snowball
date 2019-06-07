import { isString } from "../../utils";
import { EXPOSED_PROPS } from "./symbols";

function _injectable(proto, exposureName, name, descriptor, args) {
    const injectableProps = Object.prototype.hasOwnProperty.call(proto, EXPOSED_PROPS)
        ? proto[EXPOSED_PROPS]
        : (proto[EXPOSED_PROPS] = proto[EXPOSED_PROPS] ? { ...proto[EXPOSED_PROPS] } : {});

    injectableProps[exposureName] = name;

    if (!('value' in descriptor) && !('get' in descriptor) && !('writable' in descriptor) && descriptor.initializer == null) {
        return {
            writable: true,
            configurable: true
        };
    }

    descriptor.configurable = true;

    return descriptor;
}

export default function injectable(target, name, descriptor, args) {
    if (isString(target)) {
        const exposureName = target;
        return (target, name, descriptor, args) => {
            return _injectable(target, exposureName, name, descriptor, args);
        };
    }
    return _injectable(target, name, name, descriptor, args);
}
