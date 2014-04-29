declare var Symbol;

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


    // Copied from Backbone.Events

    function triggerEvents(events, args) {
        var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];

        switch (args.length) {
        case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
        case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
        case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
        case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
        default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args);
        }
    };


    // A WeakMap which holds event callbacks. The key is the object to which
    // the callbacks are attached to. This means when the object is no longer
    // referenced (and the GC disposes it), the callbacks attached to the
    // object are also disposed.
    //
    // FIXME: Use Symbol and attach the callbacks directly to the object, just
    // like we do with avers properties (see `aversPropertiesSymbol`).
    var objectEventsRegistry = new WeakMap();
    var objectListenersRegistry = new WeakMap();



    function on(self, name: string, callback, context): void {
        var objectEvents = objectEventsRegistry.get(self)
        if (!objectEvents) {
            objectEvents = Object.create(null);
            objectEventsRegistry.set(self, objectEvents);
        }

        var events = objectEvents[name] || (objectEvents[name] = []);
        events.push({callback: callback, context: context, ctx: context || self});
    }

    function off(self, name: string, callback, context): void {
        if (!name && !callback && !context) {
            objectEventsRegistry.set(self, Object.create(null));
        } else {
            var objectEvents = objectEventsRegistry.get(self);
            if (objectEvents) {
                var names    = name ? [name] : Object.keys(objectEvents)
                  , numNames = names.length;

                for (var i = 0; i < numNames; i++) {
                    var n      = names[i]
                      , events = objectEvents[n];

                    if (events) {
                        var retain = [];

                        if (callback || context) {
                            for (var j = 0, k = events.length; j < k; j++) {
                                var ev = events[j];
                                if ((callback && callback !== ev.callback) ||
                                    (context && context !== ev.context)) {
                                    retain.push(ev);
                                }
                            }
                        }

                        if (!retain.length) {
                            delete objectEvents[n];
                        } else {
                            objectEvents[n] = retain;
                        }
                    }
                }
            }
        }
    }

    function trigger(self, name: string, ...args): void {
        var objectEvents = objectEventsRegistry.get(self);
        if (objectEvents) {
            var events = objectEvents[name];
            if (events) {
                triggerEvents(events, args);
            }
        }
    }

    function listenTo(self, obj, name, callback): void {
        var listeners = objectListenersRegistry.get(self);
        if (!listeners) {
            // TODO: Make this a Map. But that requires
            // Map.prototype.forEach or map iterators. Sadly, Chrome
            // doesn't implement either of those yet.
            listeners = Object.create(null);
            objectListenersRegistry.set(self, listeners);
        }

        var id = obj._listenerId || (obj._listenerId = uniqueId('l'));
        listeners[id] = obj;
        if (typeof name === 'object') callback = self;
        on(obj, name, callback, self);
    }

    function stopListening(self, obj, name?, callback?): void {
        var listeners = objectListenersRegistry.get(self);
        if (listeners) {
            var deleteListener = !name && !callback;
            if (typeof name === 'object') callback = self;
            if (obj) (listeners = {})[obj._listenerId] = obj;
            for (var id in listeners) {
                off(listeners[id], name, callback, self);

                if (deleteListener) {
                    delete listeners[id];
                }
            }
        }
    }


    // Symbol used as the key for the avers property descriptor object. It is
    // kept private so only the Avers module has access to the descriptors.
    var aversPropertiesSymbol = Symbol('aversProperties');

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

    function setValueAtPath(obj, path: string, value): void {
        var pathKeys = path.split('.')
          , lastKey  = pathKeys.pop()
          , obj      = resolvePath<any>(obj, pathKeys.join('.'));

        obj[lastKey] = clone(value);
    }

    function applySpliceOperation(obj, path: string, op): void {
        var obj    = resolvePath<any>(obj, path)
          , insert = op.insert.map(function(x) { return withId(x, clone(x)); })
          , args   = [ op.index, op.remove.length ].concat(insert);

        splice.apply(obj, args);
    }

    export function
    applyOperation(obj, path: string, op): void {
        switch (op.type) {
        case 'set'    : return setValueAtPath(obj, path, op.value);
        case 'splice' : return applySpliceOperation(obj, path, op);
        }
    }

    export function
    initializeProperties(x) {
        // FIXME: This 'unobserve' here is probably not needed, but we use it
        // to make sure only a single 'modelChangesCallback' is attached to
        // the instance.
        (<any>Object).unobserve(x, modelChangesCallback);
        (<any>Object).observe(x, modelChangesCallback);
    }

    function
    defineProperty(x: any, name: string, desc: PropertyDescriptor): void {
        var proto      = x.prototype
          , aversProps = aversProperties(proto) || Object.create(null);

        aversProps[name] = desc;
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
        return function(json) { return parseJSON(klass, json) }
    }

    function createVariantParser(name: string, typeField, typeMap) {
        return function(json, parent) {
            var type = parent[typeField] || parent[name][typeField]
            return parseJSON(typeMap[type], json);
        }
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

        case PropertyType.Object:
        case PropertyType.Variant:
            if (json) {
                if (old) {
                    return withId(json, updateObject(old, json));
                } else {
                    return withId(json, desc.parser(json, parent));
                }
            }

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
                if (desc.type == PropertyType.Collection) {
                    x[name] = mkCollection([]);
                } else {
                    var value = result(desc, 'value');
                    if (value != prop) {
                        migrateObject(value);
                        x[name] = value;
                    }
                }
            } else if (desc.type == PropertyType.Object || desc.type == PropertyType.Variant) {
                migrateObject(prop);
            } else if (desc.type == PropertyType.Collection) {
                prop.forEach(migrateObject);
            }
        }

        return x;
    }

    export function
    deliverChangeRecords() {
        // FIXME: The polyfill doens't provide this function.
        (<any>Object).deliverChangeRecords(modelChangesCallback);
        (<any>Object).deliverChangeRecords(collectionChangeCallback);
    }

    function createObject(x) {
        var obj = new x();
        initializeProperties(obj);
        return obj;
    }

    export function
    parseJSON<T>(x, json): T {
        if (x === String || x === Number) {
            return new x(json).valueOf();
        } else {
            return withId(json, updateObject(createObject(x), json));
        }
    }

    export function
    mk<T>(x, json): T {
        return migrateObject(parseJSON(x, json));
    }

    function concatPath(self: string, child: string): string {
        if (child !== null) {
            return [self, child].join('.');
        } else {
            return self;
        }
    }

    function toObjectOperation(x) {
        return {
            type:     'set',
            object:   x.object,
            value:    x.object[x.name],
            oldValue: x.oldValue,
        };
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

    function modelChangesCallback(changes: ChangeRecord[]): void {
        changes.forEach(function(x) {
            var self = x.object
              , propertyDescriptor = aversProperties(self)[x.name];

            if (!propertyDescriptor) {
                return;
            }

            if (x.type === 'add' || x.type === 'new') {
                trigger(self, 'change', x.name, toObjectOperation(x));

                var value = self[x.name];
                if (value) {
                    if (isObservableProperty(propertyDescriptor)) {
                        listenTo(self, value, 'change', function(key, operation) {
                            trigger(self, 'change', concatPath(x.name, key), operation);
                        });
                    }
                }
            } else if (x.type === 'update' || x.type === 'updated') {
                trigger(self, 'change', x.name, toObjectOperation(x));

                if (isObservableProperty(propertyDescriptor)) {
                    if (x.oldValue) {
                        stopListening(self, x.oldValue);
                    }

                    var value = self[x.name];
                    if (value) {
                        stopListening(self, value);
                        listenTo(self, value, 'change', function(key, operation) {
                            trigger(self, 'change', concatPath(x.name, key), operation);
                        });
                    }
                }
            } else if (x.type === 'delete' || x.type === 'deleted') {
                trigger(self, 'change', x.name, toObjectOperation(x));

                if (isObservableProperty(propertyDescriptor)) {
                    stopListening(self, x.oldValue);
                }
            }
        });
    }

    function typeName(typeMap, klass): string {
        for (var type in typeMap) {
            if (typeMap[type] == klass) {
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
                    json[desc.typeField] = typeName(desc.typeMap, value.constructor)
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

    function collectionChangeCallback(changes: ChangeRecord[]): void {
        changes.forEach(function(x) {
            var self = x.object;

            if (x.type === 'splice') {
                var insert = self.slice(x.index, x.index + x.addedCount);

                trigger(self, 'change', null, {
                    type:       'splice',
                    object:     x.object,
                    index:      x.index,
                    remove:     x.removed,
                    insert:     insert,
                });

                x.removed.forEach(function(x) {
                    stopListening(self, x);

                    delete self.idMap[x.id]
                    delete self.localMap[x.id]
                });

                insert.forEach(function(x) {
                    if (x.id) {
                        self.idMap[x.id] = x;
                    } else {
                        self.localMap[uniqueId('~')] = x;
                    }

                    if (Object(x) === x) {
                        listenTo(self, x, 'change', function(key, value) {
                            var id = itemId(self, x);
                            trigger(self, 'change', concatPath(id, key), value);
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

        (<any>Array).observe(collection, collectionChangeCallback);

        return collection;
    }

    export interface Operation {
        type : string;
    }

    export interface SetOp<T> extends Operation {
        path  : string;
        value : T;
    }

    export interface SpliceOp<T> extends Operation {
        path   : string;
        index  : number;
        remove : number;
        insert : T[];
    }

    export interface ChangeCallback {
        (op: Operation): void;
    }

    export function
    attachChangeListener(obj: any, fn: ChangeCallback): void {
        on(obj, 'change', fn, null);
    }

    export function
    detachChangeListener(obj: any, fn: ChangeCallback): void {
        off(obj, 'change', fn, null);
    }
}

declare var exports;
if (typeof exports !== 'undefined') {
    exports = Avers;
} else {
    this.Avers = Avers;
}
