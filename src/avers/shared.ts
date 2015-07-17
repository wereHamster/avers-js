
export function last<T>(xs: T[]): T {
    return xs[xs.length - 1];
}

export function zip<A,B>(a: A[], b: B[]): any[] {
    return a.map((x, i) => [x, b[i]]);
}



// ---
// Object.assign polyfill

let propIsEnumerable = Object.prototype.propertyIsEnumerable;

function ToObject(val) {
    if (val == null) {
        throw new TypeError('Object.assign cannot be called with null or undefined');
    } else {
        return Object(val);
    }
}

function ownEnumerableKeys(obj) {
    let keys: any[] = Object.getOwnPropertyNames(obj);

    if (Object.getOwnPropertySymbols) {
        keys = keys.concat(Object.getOwnPropertySymbols(obj));
    }

    return keys.filter(key => propIsEnumerable.call(obj, key));
}

export function assign(target, ...source) {
    let to = ToObject(target);

    for (let s = 1; s < arguments.length; s++) {
        let from = arguments[s]
          , keys = ownEnumerableKeys(Object(from));

        for (let i = 0; i < keys.length; i++) {
            to[keys[i]] = from[keys[i]];
        }
    }

    return to;
}

// ---
