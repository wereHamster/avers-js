(function() {
    var Avers
      , root = this
      , slice = Array.prototype.slice
      , splice = Array.prototype.splice;

    if (typeof exports !== 'undefined') {
        Avers = exports;
    } else {
        Avers = root.Avers = {};
    }

    var idCounter = 0;
    function uniqueId(prefix) {
        return prefix + (++idCounter);
    }

    function result(object, property) {
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
    function extend(obj) {
        slice.call(arguments, 1).forEach(function(source) {
            for (var prop in source) {
                if (hasProp.call(source, prop)) {
                    obj[prop] = source[prop];
                }
            }
        });

        return obj;
    }


    // Copied from Backbone.Events

    var triggerEvents = function(events, args) {
        var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
        switch (args.length) {
        case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
        case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
        case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
        case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
        default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args);
        }
    };


    var Events = {

        on: function(name, callback, context) {
            this._events || (this._events = {});
            var events = this._events[name] || (this._events[name] = []);
            events.push({callback: callback, context: context, ctx: context || this});
            return this;
        },

        off: function(name, callback, context) {
            var retain, ev, events, names, i, l, j, k;
            if (!this._events) return this;
            if (!name && !callback && !context) {
                this._events = {};
                return this;
            }

            names = name ? [name] : Object.keys(this._events);
            for (i = 0, l = names.length; i < l; i++) {
                name = names[i];
                if (events = this._events[name]) {
                    this._events[name] = retain = [];
                    if (callback || context) {
                        for (j = 0, k = events.length; j < k; j++) {
                            ev = events[j];
                            if ((callback && callback !== ev.callback && callback !== ev.callback._callback) ||
                                (context && context !== ev.context)) {
                                retain.push(ev);
                            }
                        }
                    }
                    if (!retain.length) delete this._events[name];
                }
            }

            return this;
        },

        trigger: function(name) {
            if (!this._events) return this;
            var args = slice.call(arguments, 1);
            var events = this._events[name];
            if (events) triggerEvents(events, args);
            return this;
        },

        stopListening: function(obj, name, callback) {
            var listeners = this._listeners;
            if (!listeners) return this;
            var deleteListener = !name && !callback;
            if (typeof name === 'object') callback = this;
            if (obj) (listeners = {})[obj._listenerId] = obj;
            for (var id in listeners) {
                listeners[id].off(name, callback, this);
                if (deleteListener) delete this._listeners[id];
            }
            return this;
        },

        listenTo: function(obj, name, callback) {
            var listeners = this._listeners || (this._listeners = {});
            var id = obj._listenerId || (obj._listenerId = uniqueId('l'));
            listeners[id] = obj;
            if (typeof name === 'object') callback = this;
            obj.on(name, callback, this);
            return this;
        }

    };


    function withId(json, obj) {
        return extend(obj, json.id === undefined ? {} : { id: json.id });
    }

    function descendInto(obj, key) {
        if (Array.isArray(obj)) {
            return obj.idMap[key] || obj.localMap[key];
        } else if (obj === Object(obj) && obj.aversProperties && obj.aversProperties[key]) {
            return obj[key];
        }
    }

    Avers.resolvePath = function(obj, path) {
        if (path === '') {
            return obj;
        } else {
            return path.split('.').reduce(descendInto, obj);
        }
    }

    Avers.clone = function(x) {
        if (Array.isArray(x)) {
            return mkCollection(x.map(Avers.clone));
        } else if (x === Object(x) && x.aversProperties) {
            return Avers.parseJSON(x.constructor, Avers.toJSON(x));
        } else {
            return x;
        }
    }

    function setValueAtPath(obj, path, value) {
        var pathKeys = path.split('.')
          , lastKey  = pathKeys.pop()
          , obj      = Avers.resolvePath(obj, pathKeys.join('.'));

        obj[lastKey] = Avers.clone(value);
    }

    function applySpliceOperation(obj, path, op) {
        var obj  = Avers.resolvePath(obj, path)
          , args = [ op.index, op.remove.length ].concat(op.insert.map(Avers.clone));

        splice.apply(obj, args);
    }

    Avers.applyOperation = function(obj, path, op) {
        switch (op.type) {
        case 'set'    : return setValueAtPath(obj, path, op.value);
        case 'splice' : return applySpliceOperation(obj, path, op);
        }
    }

    Avers.initializeProperties = function(x) {
        extend(Object.getPrototypeOf(x), Events);

        Object.observe(x, modelChangesCallback);
    }

    Avers.defineProperty = function(x, name, desc) {
        x.prototype.aversProperties || (x.prototype.aversProperties = {});
        x.prototype.aversProperties[name] = desc;
    }

    Avers.definePrimitive = function(x, name, defaultValue) {
        var desc = { type:   'primitive'
                   , value:  defaultValue
                   };

        Avers.defineProperty(x, name, desc);
    }

    Avers.defineObject = function(x, name, klass, json) {
        var desc = { type:   'object'
                   , value:  function() { return Avers.mk(klass, json || {}) }
                   , parser: createObjectParser(klass)
                   };

        Avers.defineProperty(x, name, desc);
    }

    Avers.defineVariant = function(x, name, typeField, typeMap) {
        var desc = { type:      'variant'
                   , parser:    createVariantParser(typeField, typeMap)
                   , typeField: typeField
                   , typeMap:   typeMap
                   };

        Avers.defineProperty(x, name, desc);
    }

    Avers.defineCollection = function(x, name, klass) {
        var desc = { type:   'collection'
                   , parser: createObjectParser(klass)
                   };

        Avers.defineProperty(x, name, desc);
    }

    function createObjectParser(klass) {
        return function(json) { return Avers.parseJSON(klass, json) }
    }

    function createVariantParser(typeField, typeMap) {
        return function(json, parent) {
            return Avers.parseJSON(typeMap[parent[typeField]], json);
        }
    }

    function parseJSON(desc, old, json, parent) {
        switch (desc.type) {
        case 'collection':
            if (json) {
                if (!old) {
                    old = mkCollection();
                } else {
                    resetCollection(old);
                }

                json.forEach(function(x) {
                    old.push(withId(json, desc.parser(x, parent)));
                });

                return old;
            }

        case 'object':
        case 'variant':
            if (json) {
                if (old) {
                    return withId(json, Avers.updateObject(old, json));
                } else {
                    return withId(json, desc.parser(json, parent));
                }
            }

        case 'primitive':
            return json;
        }
    }

    Avers.updateObject = function(x, json) {
        for (var name in x.aversProperties) {
            var desc = x.aversProperties[name];

            if (json[name] != null) {
                x[name] = parseJSON(desc, x[name], json[name], json);
            }
        }

        return x;
    }

    Avers.migrateObject = function(x) {
        for (var name in x.aversProperties) {
            var desc = x.aversProperties[name]
              , prop = x[name];

            if (prop == null) {
                if (desc.type == 'collection') {
                    x[name] = mkCollection();
                } else {
                    var value = result(desc, 'value');
                    if (value != prop) {
                        Avers.migrateObject(value);
                        x[name] = value;
                    }
                }
            } else if (desc.type == 'object') {
                Avers.migrateObject(prop);
            } else if (desc.type == 'collection') {
                prop.forEach(Avers.migrateObject);
            }
        }

        return x;
    }

    Avers.deliverChangeRecords = function() {
        // FIXME: The polyfill doens't provide this function.
        Object.deliverChangeRecords(modelChangesCallback);
        Object.deliverChangeRecords(collectionChangeCallback);
    }

    Avers.parseJSON = function(x, json) {
        return withId(json, Avers.updateObject(new x(), json));
    }

    Avers.mk = function(x, json) {
        return Avers.migrateObject(Avers.parseJSON(x, json));
    }

    function concatPath(self, child) {
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

    function modelChangesCallback(changes) {
        changes.forEach(function(x) {
            var self = x.object
              , propertyDescriptor = self.aversProperties[x.name];

            if (!propertyDescriptor) {
                return;
            }

            if (x.type === 'new') {
                Events.trigger.call(self, 'change', x.name, toObjectOperation(x));

                var value = self[x.name];
                if (value) {
                    if (propertyDescriptor.type === 'object' || propertyDescriptor.type === 'collection') {
                        Events.listenTo.call(self, value, 'change', function(key, operation) {
                            Events.trigger.call(self, 'change', concatPath(x.name, key), operation);
                        });
                    }
                }
            } else if (x.type === 'updated') {
                Events.trigger.call(self, 'change', x.name, toObjectOperation(x));

                if (propertyDescriptor.type === 'object' || propertyDescriptor.type === 'collection') {
                    if (x.oldValue) {
                        Events.stopListening.call(self, x.oldValue);
                    }

                    var value = self[x.name];
                    if (value) {
                        Events.stopListening.call(self, value);
                        Events.listenTo.call(self, value, 'change', function(key, operation) {
                            Events.trigger.call(self, 'change', concatPath(x.name, key), operation);
                        });
                    }
                }
            } else if (x.type === 'deleted') {
                Events.trigger.call(self, 'change', x.name, toObjectOperation(x));

                if (propertyDescriptor.type === 'object' || propertyDescriptor.type === 'collection') {
                    Events.stopListening.call(self, x.oldValue);
                }
            }
        });
    }

    function typeName(typeMap, klass) {
        for (var type in typeMap) {
            if (typeMap[type] == klass) {
                return type;
            }
        }
    }

    function objectJSON(x) {
        var json = Object.create(null);

        for (var name in x.aversProperties) {
            var desc = x.aversProperties[name];

            switch (desc.type) {
            case 'primitive':
                json[name] = x[name];
                break;

            case 'object':
                json[name] = x[name] ? Avers.toJSON(x[name]) : null;
                break;

            case 'variant':
                var value = x[name];

                if (value) {
                    json[name]           = Avers.toJSON(value);
                    json[desc.typeField] = typeName(desc.typeMap, value.constructor)
                }
                break;

            case 'collection':
                json[name] = Avers.toJSON(x[name]);
                break;
            }
        }

        return json;
    }

    Avers.toJSON = function(x) {
        if (x === Object(x) && x.aversProperties) {
            return objectJSON(x);
        } else if (Array.isArray(x)) {
            return x.map(function(item) {
                return withId(item, Avers.toJSON(item));
            });
        } else {
            return x;
        }
    }

    Avers.itemId = function(collection, item) {
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

    function collectionChangeCallback(changes) {
        changes.forEach(function(x) {
            var self = x.object;

            if (x.type === 'splice') {
                var insert = self.slice(x.index, x.index + x.addedCount);

                Events.trigger.call(self, 'change', null, {
                    type:       'splice',
                    object:     x.object,
                    index:      x.index,
                    remove:     x.removed,
                    insert:     insert,
                });

                x.removed.forEach(function(x) {
                    Events.stopListening.call(self, x);

                    delete self.idMap[x.id]
                    delete self.localMap[x.id]
                });

                insert.forEach(function(x) {
                    if (x.id) {
                        self.idMap[x.id] = x;
                    } else {
                        self.localMap[uniqueId('~')] = x;
                    }

                    Events.listenTo.call(self, x, 'change', function(key, value) {
                        var id = Avers.itemId(self, x);
                        Events.trigger.call(self, 'change', concatPath(id, key), value);
                    });
                });
            }
        });
    }

    function resetCollection(x) {
        x.splice(0, x.length);

        x.idMap    = Object.create(null);
        x.localMap = Object.create(null);
    }

    function mkCollection(items) {
        var collection = [];
        resetCollection(collection);

        if (items) {
            splice.apply(collection, [0,0].concat(items));
        }

        extend(collection, Events);
        Array.observe(collection, collectionChangeCallback);
        return collection;
    };

})(this);
