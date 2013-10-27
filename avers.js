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

    var _ = root._;
    if (!_ && (typeof require !== 'undefined'))
        _ = require('underscore');

  // Copied from Backbone.Events

  // Regular expression used to split event strings.
  var eventSplitter = /\s+/;

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  var eventsApi = function(obj, action, name, rest) {
    if (!name) return true;

    // Handle event maps.
    if (typeof name === 'object') {
      for (var key in name) {
        obj[action].apply(obj, [key, name[key]].concat(rest));
      }
      return false;
    }

    // Handle space separated event names.
    if (eventSplitter.test(name)) {
      var names = name.split(eventSplitter);
      for (var i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
      return false;
    }

    return true;
  };


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

    // Bind an event to a `callback` function. Passing `"all"` will bind
    // the callback to all events fired.
    on: function(name, callback, context) {
      if (!eventsApi(this, 'on', name, [callback, context]) || !callback) return this;
      this._events || (this._events = {});
      var events = this._events[name] || (this._events[name] = []);
      events.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind an event to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!eventsApi(this, 'once', name, [callback, context]) || !callback) return this;
      var self = this;
      var once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      return this.on(name, once, context);
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      var retain, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;
      if (!name && !callback && !context) {
        this._events = {};
        return this;
      }

      names = name ? [name] : _.keys(this._events);
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

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) return this;
      var args = slice.call(arguments, 1);
      if (!eventsApi(this, 'trigger', name, args)) return this;
      var events = this._events[name];
      var allEvents = this._events.all;
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, arguments);
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
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
    }

  };

  var listenMethods = {listenTo: 'on', listenToOnce: 'once'};

  // Inversion-of-control versions of `on` and `once`. Tell *this* object to
  // listen to an event in another object ... keeping track of what it's
  // listening to.
  _.each(listenMethods, function(implementation, method) {
    Events[method] = function(obj, name, callback) {
      var listeners = this._listeners || (this._listeners = {});
      var id = obj._listenerId || (obj._listenerId = _.uniqueId('l'));
      listeners[id] = obj;
      if (typeof name === 'object') callback = this;
      obj[implementation](name, callback, this);
      return this;
    };
  });



    Avers.initializeProperties = function(x) {
        _.extend(x, Events);

        Object.observe(x, modelChangesCallback);

        for (var name in x.aversProperties) {
            if (x.aversProperties[name].type === 'collection') {
                x[name] = mkCollection();
            } else {
                x[name] = _.result(x.aversProperties[name].value);
            }
        }
    }

    Avers.defineProperty = function(x, name, desc) {
        x.prototype.aversProperties || (x.prototype.aversProperties = {});
        x.prototype.aversProperties[name] = desc;
    }

    Avers.definePrimitive = function(x, name, desc) {
        Avers.defineProperty(x, name, _.extend({}, desc, { type: 'primitive' }));
    }

    Avers.defineObject = function(x, name, desc) {
        Avers.defineProperty(x, name, _.extend({}, desc, { type: 'object' }));
    }

    Avers.defineCollection = function(x, name, desc) {
        Avers.defineProperty(x, name, _.extend({}, desc, { type: 'collection' }));
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
            old.slice(0);
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

    function modelChangesCallback(changes) {
        changes.forEach(function(x) {
            var self = x.object
              , propertyDescriptor = self.aversProperties[x.name];

            if (!propertyDescriptor) {
                return;
            }

            if (x.type === 'new') {
                var value = self[x.name];

                self.trigger('change', x.name, { type: 'set', value: value });
                if (value) {
                    if (propertyDescriptor.type === 'object' || propertyDescriptor.type === 'collection') {
                        self.listenTo(value, 'change', function(key, operation) {
                            self.trigger('change', concatPath(x.name, key), operation);
                        });
                    }
                }
            } else if (x.type === 'updated') {
                self.trigger('change', x.name, { type: 'set', value: self[x.name] });

                if (propertyDescriptor.type === 'object' || propertyDescriptor.type === 'collection') {
                    if (x.oldValue) {
                        self.stopListening(x.oldValue);
                    }
                    if (self[x.name]) {
                        self.stopListening(self[x.name]);
                        self.listenTo(self[x.name], 'change', function(key, operation) {
                            self.trigger('change', concatPath(x.name, key), operation);
                        });
                    }
                }
            } else if (x.type === 'deleted') {
                self.trigger('change', x.name, { type: 'set' });
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


    function collectionChangeCallback(changes) {
        changes.forEach(function(x) {
            var self = x.object;

            if (x.type === 'splice') {
                var insert = self.slice(x.index, x.index + x.addedCount);

                self.trigger('change', null, {
                    type:   'splice',
                    index:  x.index,
                    remove: x.removed.length,
                    insert: insert.map(Avers.toJSON)
                });

                x.removed.forEach(function(x) {
                    self.stopListening(x);
                });

                insert.forEach(function(x) {
                    self.listenTo(x, 'change', function(key, value) {
                        var index = self.indexOf(x);
                        self.trigger('change', concatPath(index, key), value);
                    });
                });
            }
        });
    }

    function mkCollection() {
        var collection = [];
        _.extend(collection, Events);
        Array.observe(collection, collectionChangeCallback);
        return collection;
    };

})(this);
