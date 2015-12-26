const splice = Array.prototype.splice;

function result(object, property: string) {
    if (object != null) {
        let value = object[property];
        if (typeof value === 'function') {
            return value.call(object);
        } else {
            return value;
        }
    }
}



// changeListenersSymbol
// -----------------------------------------------------------------------
//
// The symbol under which the change listeners callbacks are attached to
// an object. The value of this property is a Set. This means the
// callbacks must be unique. If you attach the same callback twice to an
// object (ie by using 'attachChangeListener') then it will be called only
// once.

const changeListenersSymbol = Symbol('aversChangeListeners');


// childListenersSymbol
// -----------------------------------------------------------------------
//
// If an object has listeners set up on any of its children, it'll keep
// a map from child to callback in a Map stored under this symbol.

const childListenersSymbol = Symbol('aversChildListeners');


function emitChanges(self, changes: Change<any>[]): void {
    let listeners = self[changeListenersSymbol];
    if (listeners) {
        listeners.forEach(fn => { fn(changes); });
    }
}

function listenTo(self, obj, callback: ChangeCallback): void {
    let listeners = self[childListenersSymbol];
    if (!listeners) {
        listeners = self[childListenersSymbol] = new Map();
    }

    listeners.set(obj, callback);
    attachChangeListener(obj, callback);
}

function stopListening(self, obj): void {
    let listeners = self[childListenersSymbol];
    if (listeners) {
        let fn = listeners.get(obj);
        if (fn) {
            detachChangeListener(obj, fn);
            listeners.delete(obj);
        }
    }
}


// Symbol used as the key for the avers property descriptor object. It is
// kept private so only the Avers module has access to the descriptors.

const aversPropertiesSymbol = Symbol('aversProperties');

interface AversProperties {
    [name: string]: PropertyDescriptor;
}

enum PropertyType { Primitive, Object, Collection, Variant };

interface PropertyDescriptor {
    type       : PropertyType;
    parser    ?: any;

    typeField ?: any;
    typeMap   ?: any;
}


// Return the property descriptors for the given object. Returns undefined
// if the object has no properties defined on it.
function aversProperties(obj): AversProperties {
    return obj[aversPropertiesSymbol];
}

function withId(json, obj) {
    if (json.id !== undefined) {
        obj.id = json.id;
    }

    return obj;
}

function descendInto(obj, key: string) {
    if (Array.isArray(obj)) {
        return obj.idMap[key];
    } else if (obj === Object(obj) && aversProperties(obj) && aversProperties(obj)[key]) {
        return obj[key];
    }
}

export function
resolvePath<T>(obj, path: string): T {
    if (path === '') {
        return obj;
    } else {
        return path.split('.').reduce(descendInto, obj);
    }
}

export function
clone(x: any): any {
    if (Array.isArray(x)) {
        return mkCollection(x.map(clone));
    } else if (x === Object(x) && aversProperties(x)) {
        return parseJSON(x.constructor, toJSON(x));
    } else {
        return x;
    }
}

function setValueAtPath(root, path: string, value): any {
    let pathKeys = path.split('.')
      , lastKey  = pathKeys.pop()
      , obj      = resolvePath<any>(root, pathKeys.join('.'));

    obj[lastKey] = clone(value);

    return root;
}

function parentPath(path: string): string {
    let pathKeys = path.split('.');
    return pathKeys.slice(0, pathKeys.length - 1).join('.');
}

function last<T>(xs: T[]): T {
    return xs[xs.length - 1];
}

// Splice operations can currently not be applied to the root. This is
// a restriction which may be lifted in the future.
function applySpliceOperation(root, path: string, op: Operation): any {
    let obj    = resolvePath<any>(root, path)
      , parent = resolvePath<any>(root, parentPath(path))
      , prop   = aversProperties(parent)[last(path.split('.'))]
      , insert = op.insert.map(json => { return prop.parser(json); })
      , args   = [ op.index, op.remove ].concat(insert);

    splice.apply(obj, args);

    return root;
}


// applyOperation
// -----------------------------------------------------------------------
//
// Apply an operation to a root object. The operation can come from
// a local change (be sure to convert the change to an 'Operation' first)
// or loaded from the server.

export function
applyOperation(root, path: string, op: Operation): void {
    switch (op.type) {
    case 'set'    : return setValueAtPath(clone(root), path, op.value);
    case 'splice' : return applySpliceOperation(clone(root), path, op);
    }
}

function
defineProperty(x: any, name: string, desc: PropertyDescriptor): void {
    let proto      = x.prototype
      , aversProps = aversProperties(proto) || Object.create(null);

    aversProps[name] = desc;
    proto[aversPropertiesSymbol] = aversProps;
}

export function
declareConstant(x: any): void {
    let proto      = x.prototype
      , aversProps = aversProperties(proto) || Object.create(null);

    proto[aversPropertiesSymbol] = aversProps;
}

export function
definePrimitive<T>(x: any, name: string, defaultValue?: T) {
    let desc = { type  : PropertyType.Primitive
               , value : defaultValue
               };

    defineProperty(x, name, desc);
}

export function
defineObject<T>(x: any, name: string, klass: any, def?: T) {
    let desc = { type   : PropertyType.Object
               , parser : createObjectParser(klass)
               , value  : undefined
               };

    if (def) {
        desc.value = () => mk(klass, def);
    }

    defineProperty(x, name, desc);
}

export function
defineVariant<T>(x: any, name: string, typeField, typeMap, def?: T) {

    // Check that all constructors are valid Avers objects. This is an
    // invariant which we can't express in the type system, but want to
    // ensure it nonetheless.
    //
    // This is something which can be removed from the production builds.

    for (let k in typeMap) {
        let aversProps = aversProperties(typeMap[k].prototype);
        if (aversProps === undefined) {
            throw new Error('Variant constructor of "' +
                k + '" is not an Avers object');
        }
    }

    let desc = { type      : PropertyType.Variant
               , parser    : createVariantParser(name, typeField, typeMap)
               , typeField : typeField
               , typeMap   : typeMap
               , value     : undefined
               };

    if (def) {
        desc.value = () => clone(def);
    }

    defineProperty(x, name, desc);
}

export function
defineCollection(x: any, name: string, klass: any) {
    let desc = { type   : PropertyType.Collection
               , parser : createObjectParser(klass)
               };

    defineProperty(x, name, desc);
}

function createObjectParser(klass) {
    return (json) => parseJSON(klass, json);
}

function createVariantParser(name: string, typeField, typeMap) {
    return function(json, parent) {
        let type = parent[typeField] || parent[name][typeField];
        return parseJSON(typeMap[type], json);
    };
}

function
parseValue(desc: PropertyDescriptor, old, json, parent) {
    switch (desc.type) {
    case PropertyType.Collection:
        if (json) {
            if (!old) {
                old = mkCollection([]);
            } else {
                resetCollection(old);
            }

            json.forEach(x => {
                old.push(withId(json, desc.parser(x, parent)));
            });

            return old;
        }
        break;

    case PropertyType.Object:
    case PropertyType.Variant:
        if (json) {
            if (old) {
                return withId(json, updateObject(old, json));
            } else {
                return withId(json, desc.parser(json, parent));
            }
        }
        break;

    case PropertyType.Primitive:
        return json;
    }
}

export function
updateObject(x, json) {
    let aversProps = aversProperties(x);

    for (let name in aversProps) {
        let desc = aversProps[name];

        if (json[name] != null) {
            x[name] = parseValue(desc, x[name], json[name], json);
        }
    }

    return x;
}

export function
migrateObject(x) {
    let aversProps = aversProperties(x);

    for (let name in aversProps) {
        let desc = aversProps[name]
          , prop = x[name];

        if (prop == null) {
            if (desc.type === PropertyType.Collection) {
                x[name] = mkCollection([]);
            } else {
                let value = result(desc, 'value');
                if (value != null && value !== prop) {
                    migrateObject(value);
                    x[name] = value;
                }
            }
        } else if (desc.type === PropertyType.Object || desc.type === PropertyType.Variant) {
            migrateObject(prop);
        } else if (desc.type === PropertyType.Collection) {
            prop.forEach(migrateObject);
        }
    }

    return x;
}

let objectProxyHandler = {
    set: (target, property, value, receiver) => {
        let oldValue           = target[property]
          , propertyDescriptor = aversProperties(target)[property];

        target[property] = value;

        if (propertyDescriptor) {
            if (isObservableProperty(propertyDescriptor)) {
                if (oldValue) {
                    stopListening(target, oldValue);
                }

                if (value) {
                    // FIXME: Is this 'stopListening' needed?
                    stopListening(target, value);
                    forwardChanges(target, value, property);
                }
            }

            emitChanges(target, [
                new Change(property, new Operation.Set(target, value, oldValue))
            ]);
        }

        return true;
    },

    deleteProperty: (target, property) => {
        let oldValue           = target[property]
          , propertyDescriptor = aversProperties(target)[property];

        if (propertyDescriptor && isObservableProperty(propertyDescriptor) && oldValue) {
            stopListening(target, oldValue);
        }

        emitChanges(target, [
            new Change(property, new Operation.Set(target, undefined, oldValue))
        ]);

        return true;
    },
};

function createObject<T>(x: new() => T): T {
    return new Proxy(new x, objectProxyHandler);
}

export function
parseJSON<T>(x: new() => T, json): T {
    if ((<any>x) === String || (<any>x) === Number) {
        return new (<any>x)(json).valueOf();
    } else {
        return withId(json, updateObject(createObject(x), json));
    }
}

export function
mk<T>(x: new() => T, json): T {
    return migrateObject(parseJSON(x, json));
}

function concatPath(self: string, child: string): string {
    if (child !== null) {
        return [self, child].join('.');
    } else {
        return self;
    }
}


// Return true if the property can generate change events and thus the
// parent should listen to events.
function isObservableProperty(propertyDescriptor: PropertyDescriptor): boolean {
    let type = propertyDescriptor.type;
    return type === PropertyType.Object || type === PropertyType.Variant || type === PropertyType.Collection;
}

interface ChangeRecord {
    type       : string;
    name       : string;
    object     : any;
    oldValue   : any;
    index      : number;
    addedCount : number;
    removed    : any[];
}

export function
typeName(typeMap, klass): string {
    for (let type in typeMap) {
        if (typeMap[type] === klass) {
            return type;
        }
    }
}

function objectJSON(x) {
    let json       = Object.create(null)
      , aversProps = aversProperties(x);

    for (let name in aversProps) {
        let desc = aversProps[name];

        switch (desc.type) {
        case PropertyType.Primitive:
            json[name] = x[name];
            break;

        case PropertyType.Object:
            json[name] = x[name] ? toJSON(x[name]) : null;
            break;

        case PropertyType.Variant:
            let value = x[name];

            if (value) {
                json[name]           = toJSON(value);
                json[desc.typeField] = typeName(desc.typeMap, value.constructor);
            }
            break;

        case PropertyType.Collection:
            json[name] = toJSON(x[name]);
            break;
        }
    }

    return json;
}

export function
toJSON(x) {
    if (x === Object(x) && aversProperties(x)) {
        return objectJSON(x);
    } else if (Array.isArray(x)) {
        return x.map(item => withId(item, toJSON(item)));
    } else {
        return x;
    }
}


export interface Item {
    id : string;
}

export function
itemId<T extends Item>(collection: Collection<T>, item: T): string {
    // ASSERT: collection.idMap[item.id] === item
    return item.id;
}

export interface Collection<T extends Item> extends Array<T> {
    idMap : { [id: string]: T };
}

function resetCollection<T extends Item>(x: Collection<T>): void {
    x.splice(0, x.length);
    x.idMap = Object.create(null);
}

function mkCollection<T extends Item>(items: T[]): Collection<T> {
    let collection = <Collection<T>> [];
    resetCollection(collection);


    if (items.length > 0) {
        let args = (<any>[0,0]).concat(items);
        splice.apply(collection, args);
    }


    function _splice(start: number, deleteCount: number, ...items: T[]): T[] {
        let deletedItems = collection.slice(start, start + deleteCount);

        splice.call(collection, start, deleteCount, ...items);

        deletedItems.forEach(item => {
            stopListening(collection, item);
            delete collection.idMap[item.id];
        });

        items.forEach(item => {
            if (Object(item) === item) {
                collection.idMap[item.id] = item;

                listenTo(collection, item, changes => {
                    let id = itemId(collection, item);
                    emitChanges(collection, changes.map(change => embedChange(change, id)));
                });
            }
        });

        emitChanges(collection, [
            new Change(null, new Operation.Splice(collection, start, deletedItems, items))
        ]);

        return deletedItems;
    }


    collection.push = (...items) => {
        _splice(collection.length, 0, ...items);
        return collection.length;
    };

    collection.pop = () => {
        return _splice(collection.length - 1, 1)[0];
    };

    collection.splice = <any> ((start: number, deleteCount: number, ...items: T[]): T[] => {
        return _splice(start, deleteCount, ...items);
    });

    collection.shift = () => {
        return _splice(0, 1)[0];
    };

    collection.unshift = (...items) => {
        _splice(0, 0, ...items);
        return collection.length;
    };


    return collection;
}


// lookupItem
// -----------------------------------------------------------------------
//
// Return the item in the collection which has the given id. May return
// undefined if no such item exists.

export function
lookupItem<T extends Item>(collection: Collection<T>, id: string): T {
    return collection.idMap[id];
}


// Operation
// -----------------------------------------------------------------------
//
// Definition of a pure JavaScript object which describes a change at
// a particular path. It can be converted directly to JSON.

export interface Operation {
    // The path at which the change happened.
    path    : string;

    // Either 'set' or 'splice'. The remaining fields depend on the value
    // of this.
    type    : string;

    // Set
    value  ?: any;

    // Splice
    index  ?: number;
    remove ?: number;
    insert ?: any[];
}



// Change
// -----------------------------------------------------------------------
//
// A 'Change' is an description of a 'Set' or 'Splice' change which has
// happened at a particular path.

export class Change<T> {
    constructor
      ( public path   : string
      , public record : T
      ) {}
}

export module Operation {

    export class Set {
        constructor
          ( public object   : any
          , public value    : any
          , public oldValue : any
          ) {}
    }

    export class Splice {
        constructor
          ( public object : any
          , public index  : number
          , public remove : any[]
          , public insert : any[]
          ) {}
    }

}


function embedChange<T>(change: Change<T>, key: string): Change<T> {
    return new Change(concatPath(key, change.path), change.record);
}

function forwardChanges(obj, prop, key: string) {
    listenTo(obj, prop, changes => {
        emitChanges(obj, changes.map(change => embedChange(change, key)));
    });
}


// changeOperation
// -----------------------------------------------------------------------
//
// Convert a 'Change' to an 'Operation' which is a pure JS object and can
// be directly converted to JSON and sent over network.

export function
changeOperation(change: Change<any>): Operation {
    const record = change.record;

    if (record instanceof Operation.Set) {
        return { path   : change.path
               , type   : 'set'
               , value  : toJSON(record.value)
               };

    } else if (record instanceof Operation.Splice) {
        return { path   : change.path
               , type   : 'splice'
               , index  : record.index
               , remove : record.remove.length
               , insert : toJSON(record.insert)
               };

    } else {
        throw new Error('Unknown change record: ' + record);
    }
}

export interface ChangeCallback {
    (changes: Change<any>[]): void;
}


// attachChangeListener
// -----------------------------------------------------------------------
//
// Attach a change callback to the object. It will be called each time the
// object or any of its properties change.

export function
attachChangeListener(obj: any, fn: ChangeCallback): void {
    let listeners = obj[changeListenersSymbol] || new Set();
    obj[changeListenersSymbol] = listeners;

    listeners.add(fn);
}


// detachChangeListener
// -----------------------------------------------------------------------
//
// Detach a given change listener callback from an object.

export function
detachChangeListener(obj: any, fn: ChangeCallback): void {
    let listeners = obj[changeListenersSymbol];
    if (listeners) {
        listeners.delete(fn);
    }
}
