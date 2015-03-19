module Avers {

    var splice = Array.prototype.splice;

    var idCounter = 0;
    function uniqueId(prefix: string): string {
        return prefix + (++idCounter);
    }

    function result(object, property: string) {
        if (object != null) {
            var value = object[property];
            if (typeof value === 'function') {
                return value.call(object);
            } else {
                return value;
            }
        }
    }

    var hasProp = {}.hasOwnProperty;
    function extend(obj, ...args) {
        args.forEach(function(source) {
            for (var prop in source) {
                if (hasProp.call(source, prop)) {
                    obj[prop] = source[prop];
                }
            }
        });

        return obj;
    }


    // changeCallbackSymbol
    // -----------------------------------------------------------------------
    //
    // Avers attaches a unique callback to each object or collection and saves
    // a reference to the callback under this symbol.

    var changeCallbackSymbol = <any> Symbol('aversChangeCallback');


    // changeListenersSymbol
    // -----------------------------------------------------------------------
    //
    // The symbol under which the change listeners callbacks are attached to
    // an object. The value of this property is a Set. This means the
    // callbacks must be unique. If you attach the same callback twice to an
    // object (ie by using 'attachChangeListener') then it will be called only
    // once.

    var changeListenersSymbol = <any> Symbol('aversChangeListeners');


    // childListenersSymbol
    // -----------------------------------------------------------------------
    //
    // If an object has listeners set up on any of its children, it'll keep
    // a map from child to callback in a Map stored under this symbol.

    var childListenersSymbol = <any> Symbol('aversChildListeners');


    function emitChanges(self, changes: Change<any>[]): void {
        var listeners = self[changeListenersSymbol];
        if (listeners) {
            listeners.forEach(fn => {
                fn(changes);
            });
        }
    }

    function listenTo(self, obj, callback: ChangeCallback): void {
        var listeners = self[childListenersSymbol];
        if (!listeners) {
            listeners = self[childListenersSymbol] = new Map();
        }

        listeners.set(obj, callback);
        attachChangeListener(obj, callback);
    }

    function stopListening(self, obj): void {
        var listeners = self[childListenersSymbol];
        if (listeners) {
            var fn = listeners.get(obj);
            if (fn) {
                detachChangeListener(obj, fn);
                listeners.delete(obj);
            }
        }
    }


    // Symbol used as the key for the avers property descriptor object. It is
    // kept private so only the Avers module has access to the descriptors.

    var aversPropertiesSymbol = <any> Symbol('aversProperties');

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
        return extend(obj, json.id === undefined ? {} : { id: json.id });
    }

    function descendInto(obj, key: string) {
        if (Array.isArray(obj)) {
            return obj.idMap[key] || obj.localMap[key];
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

    function setValueAtPath(root, path: string, value): void {
        var pathKeys = path.split('.')
          , lastKey  = pathKeys.pop()
          , obj      = resolvePath<any>(root, pathKeys.join('.'));

        obj[lastKey] = clone(value);
    }

    function parentPath(path: string): string {
        var pathKeys = path.split('.');
        return pathKeys.slice(0, pathKeys.length - 1).join('.');
    }

    function last<T>(xs: T[]): T {
        return xs[xs.length - 1];
    }

    // Splice operations can currently not be applied to the root. This is
    // a restriction which may be lifted in the future.
    function applySpliceOperation(root, path: string, op: Operation): void {
        var obj    = resolvePath<any>(root, path)
          , parent = resolvePath<any>(root, parentPath(path))
          , prop   = aversProperties(parent)[last(path.split('.'))]
          , insert = op.insert.map(json => { return prop.parser(json); })
          , args   = [ op.index, op.remove ].concat(insert);

        splice.apply(obj, args);
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
        case 'set'    : return setValueAtPath(root, path, op.value);
        case 'splice' : return applySpliceOperation(root, path, op);
        }
    }

    export function
    initializeProperties(x) {
        if (!x[changeCallbackSymbol]) {
            var fn = x[changeCallbackSymbol] = objectChangesCallback.bind(x);
            (<any>Object).observe(x, fn);
        }
    }

    function
    defineProperty(x: any, name: string, desc: PropertyDescriptor): void {
        var proto      = x.prototype
          , aversProps = aversProperties(proto) || Object.create(null);

        aversProps[name] = desc;
        proto[aversPropertiesSymbol] = aversProps;
    }

    export function
    declareConstant(x: any): void {
        var proto      = x.prototype
          , aversProps = aversProperties(proto) || Object.create(null);

        proto[aversPropertiesSymbol] = aversProps;
    }

    export function
    definePrimitive<T>(x: any, name: string, defaultValue?: T) {
        var desc = { type  : PropertyType.Primitive
                   , value : defaultValue
                   };

        defineProperty(x, name, desc);
    }

    export function
    defineObject<T>(x: any, name: string, klass: any, def?: T) {
        var desc = { type   : PropertyType.Object
                   , parser : createObjectParser(klass)
                   , value  : undefined
                   };

        if (def) {
            desc.value = function() {
                return mk(klass, def);
            };
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

        for (var k in typeMap) {
            var aversProps = aversProperties(typeMap[k].prototype);
            if (aversProps === undefined) {
                throw new Error('Variant constructor of "' +
                    k + '" is not an Avers object');
            }
        }

        var desc = { type      : PropertyType.Variant
                   , parser    : createVariantParser(name, typeField, typeMap)
                   , typeField : typeField
                   , typeMap   : typeMap
                   , value     : undefined
                   };

        if (def) {
            desc.value = function() {
                return clone(def);
            };
        }

        defineProperty(x, name, desc);
    }

    export function
    defineCollection(x: any, name: string, klass: any) {
        var desc = { type   : PropertyType.Collection
                   , parser : createObjectParser(klass)
                   };

        defineProperty(x, name, desc);
    }

    function createObjectParser(klass) {
        return function(json) { return parseJSON(klass, json); };
    }

    function createVariantParser(name: string, typeField, typeMap) {
        return function(json, parent) {
            var type = parent[typeField] || parent[name][typeField];
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

                json.forEach(function(x) {
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
        var aversProps = aversProperties(x);

        for (var name in aversProps) {
            var desc = aversProps[name];

            if (json[name] != null) {
                x[name] = parseValue(desc, x[name], json[name], json);
            }
        }

        return x;
    }

    export function
    migrateObject(x) {
        var aversProps = aversProperties(x);

        for (var name in aversProps) {
            var desc = aversProps[name]
              , prop = x[name];

            if (prop == null) {
                if (desc.type === PropertyType.Collection) {
                    x[name] = mkCollection([]);
                } else {
                    var value = result(desc, 'value');
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


    // deliverChangeRecords
    // -----------------------------------------------------------------------
    //
    // Deliver all outstanding change records for the given object and all its
    // children, if applicable. See Object.deliverChangeRecords.

    export function
    deliverChangeRecords(obj): void {
        var fn = obj[changeCallbackSymbol];
        if (fn) {
            (<any>Object).deliverChangeRecords(fn);

            // Flush changes in children.
            if (Array.isArray(obj)) {
                obj.forEach(x => {
                    deliverChangeRecords(x);
                });

            } else if (obj === Object(obj)) {
                var aversProps = aversProperties(obj);

                for (var name in aversProps) {
                    var prop = obj[name];
                    if (prop === Object(prop)) {
                        deliverChangeRecords(prop);
                    }
                }
            }
        }
    }

    function createObject<T>(x: new() => T): T {
        var obj = new x();
        initializeProperties(obj);
        return obj;
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
        var obj = migrateObject(parseJSON(x, json));
        deliverChangeRecords(obj);
        return obj;
    }

    function concatPath(self: string, child: string): string {
        if (child !== null) {
            return [self, child].join('.');
        } else {
            return self;
        }
    }

    function toObjectOperation(x: ChangeRecord): Operation.Set {
        var object = x.object;

        return new Operation.Set
            ( object
            , object[x.name]
            , x.oldValue
            );
    }


    // Return true if the property can generate change events and thus the
    // parent should listen to events.
    function isObservableProperty(propertyDescriptor: PropertyDescriptor): boolean {
        var type = propertyDescriptor.type;
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

    function objectChangesCallback(changes: ChangeRecord[]): void {
        changes.forEach(function(x) {
            var self = x.object
              , propertyDescriptor = aversProperties(self)[x.name];

            if (!propertyDescriptor) {
                return;
            }

            if (x.type === 'add') {
                emitChanges(self, [new Change(x.name, toObjectOperation(x))]);

                var value = self[x.name];
                if (value) {
                    if (isObservableProperty(propertyDescriptor)) {
                        forwardChanges(self, value, x.name);
                    }
                }
            } else if (x.type === 'update') {
                emitChanges(self, [new Change(x.name, toObjectOperation(x))]);

                if (isObservableProperty(propertyDescriptor)) {
                    if (x.oldValue) {
                        stopListening(self, x.oldValue);
                    }

                    var value = self[x.name];
                    if (value) {
                        stopListening(self, value);
                        forwardChanges(self, value, x.name);
                    }
                }
            } else if (x.type === 'delete') {
                emitChanges(self, [new Change(x.name, toObjectOperation(x))]);

                if (isObservableProperty(propertyDescriptor)) {
                    stopListening(self, x.oldValue);
                }
            }
        });
    }

    export function
    typeName(typeMap, klass): string {
        for (var type in typeMap) {
            if (typeMap[type] === klass) {
                return type;
            }
        }
    }

    function objectJSON(x) {
        var json       = Object.create(null)
          , aversProps = aversProperties(x);

        for (var name in aversProps) {
            var desc = aversProps[name];

            switch (desc.type) {
            case PropertyType.Primitive:
                json[name] = x[name];
                break;

            case PropertyType.Object:
                json[name] = x[name] ? toJSON(x[name]) : null;
                break;

            case PropertyType.Variant:
                var value = x[name];

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
            return x.map(function(item) {
                return withId(item, toJSON(item));
            });
        } else {
            return x;
        }
    }

    export function
    itemId<T extends Item>(collection: Collection<T>, item: T): string {
        if (item.id) {
            // ASSERT: collection.idMap[item.id] === item
            return item.id;
        } else {
            var localMap = collection.localMap;
            for (var id in localMap) {
                if (localMap[id] === item) {
                    return id;
                }
            }
        }
    }

    function collectionChangesCallback(changes: ChangeRecord[]): void {
        changes.forEach(function(x) {
            var self = x.object;

            if (x.type === 'splice') {
                var insert = self.slice(x.index, x.index + x.addedCount);

                emitChanges(self, [new Change(null, new Operation.Splice
                    ( x.object
                    , x.index
                    , x.removed
                    , insert
                    )
                )]);

                x.removed.forEach(function(x) {
                    stopListening(self, x);

                    delete self.idMap[x.id];
                    delete self.localMap[x.id];
                });

                insert.forEach(function(x) {
                    if (x.id) {
                        self.idMap[x.id] = x;
                    } else {
                        self.localMap[uniqueId('~')] = x;
                    }

                    if (Object(x) === x) {
                        listenTo(self, x, function(changes) {
                            var id = itemId(self, x);
                            emitChanges(self, changes.map(change => {
                                return embedChange(change, id);
                            }));
                        });
                    }
                });
            }
        });
    }

    export interface Item {
        id : string;
    }

    export interface Collection<T extends Item> extends Array<T> {
        idMap    : { [id: string]: T };
        localMap : { [id: string]: T };
    }

    function resetCollection<T extends Item>(x: Collection<T>): void {
        x.splice(0, x.length);

        x.idMap    = Object.create(null);
        x.localMap = Object.create(null);
    }

    function mkCollection<T extends Item>(items: T[]): Collection<T> {
        var collection = <Collection<T>> [];
        resetCollection(collection);

        if (items.length > 0) {
            var args = (<any>[0,0]).concat(items);
            splice.apply(collection, args);
        }

        var fn = collection[changeCallbackSymbol] = collectionChangesCallback.bind(collection);
        (<any>Array).observe(collection, fn);

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
        return new Change
            ( concatPath(key, change.path)
            , change.record
            );
    }

    function forwardChanges(obj, prop, key: string) {
        listenTo(obj, prop, changes => {
            emitChanges(obj, changes.map(change => {
                return embedChange(change, key);
            }));
        });
    }


    // changeOperation
    // -----------------------------------------------------------------------
    //
    // Convert a 'Change' to an 'Operation' which is a pure JS object and can
    // be directly converted to JSON and sent over network.

    export function
    changeOperation(change: Change<any>): Operation {
        if (change.record instanceof Operation.Set) {
            var set = <Operation.Set> change.record;

            return { path   : change.path
                   , type   : 'set'
                   , value  : toJSON(set.value)
                   };

        } else if (change.record instanceof Operation.Splice) {
            var splice = <Operation.Splice> change.record;

            return { path   : change.path
                   , type   : 'splice'
                   , index  : splice.index
                   , remove : splice.remove.length
                   , insert : toJSON(splice.insert)
                   };


        } else {
            throw new Error('Unknown change record: ' + change.record);
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
        var listeners = obj[changeListenersSymbol] || new Set();
        obj[changeListenersSymbol] = listeners;

        listeners.add(fn);
    }


    // detachChangeListener
    // -----------------------------------------------------------------------
    //
    // Detach a given change listener callback from an object.

    export function
    detachChangeListener(obj: any, fn: ChangeCallback): void {
        var listeners = obj[changeListenersSymbol];
        if (listeners) {
            listeners.delete(fn);
        }
    }
}

declare var exports;
if (typeof exports !== 'undefined') {
    exports = Avers;
} else {
    this.Avers = Avers;
}
