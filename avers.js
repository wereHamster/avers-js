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


    function descendInto(obj, key) {
        if (Array.isArray(obj)) {
            return obj.idMap[key] || obj.localMap[key];
        } else if (obj === Object(obj) && obj.aversProperties && obj.aversProperties[key]) {
            return obj[key];
        }
    }


    Avers.resolvePath = function(obj, path) {
        return path.split('.').reduce(descendInto, obj);
    }


    Avers.initializeProperties = function(x) {
        extend(x, Events);

        Object.observe(x, modelChangesCallback);

        for (var name in x.aversProperties) {
            if (x.aversProperties[name].type === 'collection') {
                x[name] = mkCollection();
            } else {
                x[name] = result(x.aversProperties[name].value);
            }
        }
    }

    Avers.defineProperty = function(x, name, desc) {
        x.prototype.aversProperties || (x.prototype.aversProperties = {});
        x.prototype.aversProperties[name] = desc;
    }

    Avers.definePrimitive = function(x, name, desc) {
        Avers.defineProperty(x, name, extend({}, desc, { type: 'primitive' }));
    }

    Avers.defineObject = function(x, name, desc) {
        Avers.defineProperty(x, name, extend({}, desc, { type: 'object' }));
    }

    Avers.defineCollection = function(x, name, desc) {
        Avers.defineProperty(x, name, extend({}, desc, { type: 'collection' }));
    }

    Avers.typeTag = function(x, value) {
        Avers.definePrimitive(x, 'type', { value: value, writeable: false });
    }

    Avers.createParser = function(x) {
        var args = slice.call(arguments);
        if (args.length == 1) {
            return function(json) { return Avers.parseJSON(x, json) }
        } else {
            var typeMap = {};
            args.forEach(function(x) {
                typeMap[x.prototype.aversProperties.type.value] = x;
            });

            return function(json) {
                return Avers.parseJSON(typeMap[json.type], json);
            }
        }
    }

    function parseJSON(desc, old, json) {
        switch (desc.type) {
        case 'collection':
            resetCollection(old);
            json.forEach(function(x) { old.push(desc.parser(x)) });
            return old;

        case 'object':
            if (old) {
                return Avers.updateObject(old, json);
            } else {
                return desc.parser(json);
            }

        case 'primitive':
            return json;
        }
    }

    Avers.updateObject = function(x, json) {
        for (var name in x.aversProperties) {
            var desc = x.aversProperties[name];
            x[name] = parseJSON(desc, x[name], json[name]);
        }

        return x;
    }

    Avers.deliverChangeRecords = function() {
        // FIXME: The polyfill doens't provide this function.
        Object.deliverChangeRecords(modelChangesCallback);
        Object.deliverChangeRecords(collectionChangeCallback);
    }

    Avers.parseJSON = function(x, json) {
        return Avers.updateObject(new x(), json);
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
                self.trigger('change', x.name, toObjectOperation(x));

                var value = self[x.name];
                if (value) {
                    if (propertyDescriptor.type === 'object' || propertyDescriptor.type === 'collection') {
                        self.listenTo(value, 'change', function(key, operation) {
                            self.trigger('change', concatPath(x.name, key), operation);
                        });
                    }
                }
            } else if (x.type === 'updated') {
                self.trigger('change', x.name, toObjectOperation(x));

                if (propertyDescriptor.type === 'object' || propertyDescriptor.type === 'collection') {
                    if (x.oldValue) {
                        self.stopListening(x.oldValue);
                    }

                    var value = self[x.name];
                    if (value) {
                        self.stopListening(value);
                        self.listenTo(value, 'change', function(key, operation) {
                            self.trigger('change', concatPath(x.name, key), operation);
                        });
                    }
                }
            } else if (x.type === 'deleted') {
                self.trigger('change', x.name, toObjectOperation(x));

                if (propertyDescriptor.type === 'object' || propertyDescriptor.type === 'collection') {
                    self.stopListening(x.oldValue);
                }
            }
        });
    }

    Avers.toJSON = function(x) {
        if (x === Object(x) && x.aversProperties) {
            var json = Object.create(null);

            for (var name in x.aversProperties) {
                switch (x.aversProperties[name].type) {
                case 'primitive':  json[name] = x[name]; break;
                case 'object':     json[name] = x[name] ? Avers.toJSON(x[name]) : null; break;
                case 'collection': json[name] = Avers.toJSON(x[name]); break;
                }
            }

            return json;
        } else if (Array.isArray(x)) {
            return x.map(Avers.toJSON);
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

                self.trigger('change', null, {
                    type:       'splice',
                    object:     x.object,
                    index:      x.index,
                    remove:     x.removed,
                    insert:     insert,
                });

                x.removed.forEach(function(x) {
                    self.stopListening(x);

                    delete self.idMap[x.id]
                    delete self.localMap[x.id]
                });

                insert.forEach(function(x) {
                    if (x.id) {
                        self.idMap[x.id] = x;
                    } else {
                        self.localMap[uniqueId('~')] = x;
                    }

                    self.listenTo(x, 'change', function(key, value) {
                        var id = Avers.itemId(self, x);
                        self.trigger('change', concatPath(id, key), value);
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

    function mkCollection() {
        var collection = [];
        resetCollection(collection);

        extend(collection, Events);
        Array.observe(collection, collectionChangeCallback);
        return collection;
    };

})(this);
