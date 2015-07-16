// Avers Storage Extension
// ---------------------------------------------------------------------------
//
// This is an extension for the Avers module which adds functionality to
// manage 'Editable' objects and synchronize changes to a server through
// a HTTP API.
//
// This file depends on the Computation library [1], ES6 Promises [2] and
// Symbol [3].
//
// [1]: https://github.com/wereHamster/computation
// [2]: https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Promise
// [3]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol



module Avers {

    const aversNamespace = Symbol('aversNamespace');


    // TODO: Drop this once TypeScript itself provides the definition of the
    // W3C Fetch API or find one (eg. DefinitelyTyped) and point users to it.

    export interface Fetch {
        (input: string, init?): Promise<any>;
    }



    export interface ObjectConstructor<T> {
        new(): T;
    }


    export class Handle {

        generationNumber = 0;
        // ^ Incremented everytime something managed by this handle changes.

        objectCache = new Map<string, Editable<any>>();
        staticCache = new Map<Symbol, Map<string, Static<any>>>();

        constructor
          ( public apiHost : string
            // ^ The hostname where we can reach the Avers API server. Leave
            // out the trailing slash.
            //
            // Example: "//localhost:8000"

          , public fetch : Fetch
            // ^ API to send network requests. If you use this extension in
            // a web browser, you can pass in the 'fetch' function directly.

          , public now : () => number
            // ^ Function which returns the current time. You can use 'Date.now'
            // or 'window.performance.now', depending on how accurate time
            // resolution you need.

          , public infoTable : Map<string, ObjectConstructor<any>>
            // ^ All object types which the client can parse.

          ) {}
    }



    interface Action {
        label  : string;
        applyF : (h: Handle) => void;
    }

    function mkAction(label, applyF): Action {
        return { label, applyF };
    }

    function modifyHandle(h: Handle, act: Action): void {
        (<any>Object).getNotifier(h).notify({
            type: 'Avers::Action', action: act
        });

        act.applyF(h);
        startNextGeneration(h);
    }



    export function startNextGeneration(h: Handle): void {
        h.generationNumber++;
    }


    // attachGenerationListener
    // -----------------------------------------------------------------------
    //
    // Attach a listener to the handle which will be invoked everytime data
    // managed by the handle changes.
    //
    // If you need to detache the listener later, hang on to the return value
    // and pass that to 'detachGenerationListener'.

    export function
    attachGenerationListener(h: Handle, f: () => void): Function {
        function generationChangeCallback(records) {
            var changedGeneration = records.some(rec => {
                return rec.name === 'generationNumber';
            });

            if (changedGeneration) {
                f();
            }
        }

        (<any>Object).observe(h, generationChangeCallback);

        return generationChangeCallback;
    }


    // detachGenerationListener
    // -----------------------------------------------------------------------
    //
    // Detach a generation listener from the handle. The listener is the value
    // you get from 'attachGenerationListener'.

    export function
    detachGenerationListener(h: Handle, listener: Function): void {
        (<any>Object).unobserve(h, listener);
    }


    export function
    endpointUrl(h: Handle, path: string): string {
        return h.apiHost + path;
    }


    // networkRequests
    // -----------------------------------------------------------------------
    //
    // Array of all network requests which are currently active on the handle.

    export function
    networkRequests(h: Handle): NetworkRequest[] {
        let ret = [];

        for (let obj of h.objectCache.values()) {
            ret.push(obj.networkRequest);
        }

        return ret.filter(x => { return x !== undefined; });
    }



    // localChanges
    // -----------------------------------------------------------------------
    //
    // Array of all objects which have local changes which were not yet
    // submitted to the server.

    export function
    localChanges(h: Handle): { obj: Editable<any>; changes: Operation[]; }[] {
        let ret = [];

        for (let obj of h.objectCache.values()) {
            if (obj.localChanges.length > 0) {
                ret.push({ obj: obj, changes: obj.localChanges });
            }
        }

        return ret;
    }



    // mkEditable
    // -----------------------------------------------------------------------
    //
    // Create a new Editable and load an object from the server into it. The
    // object is cached in the handle, so it is safe to call this function
    // repeatedly with the same id.

    function
    mkEditable<T>(h: Handle, id: string): Editable<T> {
        let obj = h.objectCache.get(id);
        if (!obj) {
            obj = new Editable<T>(id);
            h.objectCache.set(id, obj);

            loadEditable(h, obj);
        }

        return obj;
    }


    // lookupEditable
    // -----------------------------------------------------------------------
    //
    // Get an object by its id. This computation is pending until the object
    // has been fully loaded.

    export function
    lookupEditable<T>(h: Handle, id: string): Computation<Editable<T>> {
        return new Computation(() => {
            if (id) {
                let obj = mkEditable<T>(h, id);
                if (!obj.content) {
                    return <Editable<T>> Computation.Pending;
                } else {
                    return obj;
                }

            } else {
                throw new Error('Avers.lookupEditable: invalid id <' + id + '>');
            }
        });
    }


    // lookupContent
    // -----------------------------------------------------------------------
    //
    // Often you don't need the whole Editable wrapper, but the content inside
    // it. This is a convenience function to get just that.

    export function
    lookupContent<T>(h: Handle, id: string): Computation<T> {
        return lookupEditable<T>(h, id).fmap(x => {
            return x.content;
        });
    }


    // fetchEditable
    // -----------------------------------------------------------------------
    //
    // Wait until an Editable is Loaded or Failed (the Promise is resolved or
    // rejected accordingly). This is useful in asynchronous code where you
    // can't use 'Computation' (lookupEditable).

    export function
    fetchEditable<T>(h: Handle, id: string): Promise<Editable<T>> {
        return new Promise((resolve, reject) => {
            (function check(obj?) {
                obj = mkEditable(h, id);

                if (obj.status === Status.Loaded) {
                    resolve(obj);
                } else if (obj.status === Status.Failed) {
                    reject();
                } else {
                    let nr  = obj.networkRequest
                      , req = nr ? nr.promise : loadEditable(h, obj);

                    req.then(check).catch(check);
                }
            })();
        });
    }





    // TODO: Consider defining a sumtype so we can store additional data along
    // with the `Failed` status.
    export enum Status { Empty, Loaded, Failed }



    function debounce<T extends Function>(func: T, wait, immediate = undefined): T {
        let timeout, args, context, timestamp, result;

        let later = function() {
            let last = Date.now() - timestamp;

            if (last < wait && last >= 0) {
                timeout = setTimeout(later, wait - last);
            } else {
                timeout = null;
                if (!immediate) {
                    result = func.apply(context, args);
                    if (!timeout) { context = args = null; };
                }
            }
        };

        return <any> function() {
            context = this;
            args = arguments;
            timestamp = Date.now();
            let callNow = immediate && !timeout;
            if (!timeout) { timeout = setTimeout(later, wait); };
            if (callNow) {
                result = func.apply(context, args);
                context = args = null;
            }

            return result;
        };
    }


    export class NetworkRequest {
        constructor
          ( public createdAt : number
          , public promise   : Promise<{}>
          ) {}
    }


    export class Editable<T> {

        status : Status = Status.Empty;


        networkRequest : NetworkRequest = undefined;

        // ^ If we have a active network request at the moment (either to
        // fetch the object or saving changes etc) then this describes it. We
        // store the time when the request was started along with the promise.
        // This helps identify long running requests, so the UI can update
        // accordingly.
        //
        // To cancel the request (or rather, its effects on the local state),
        // simply set the field to 'undefined' or start another request.
        // Before a promise applies its effects, it checks whether it is still
        // current, and if not it will simply abort.


        type             : string;

        createdAt        : Date;

        createdBy        : string;
        // ^ The primary author who created this object.

        revisionId       : number;
        // ^ The RevId as we think is the latest on the server. Local changes
        // are submitted against this RevId.

        shadowContent    : T;
        // ^ The content of the object at 'revisionId'.


        content          : T;

        submittedChanges : Avers.Operation[] = [];
        localChanges     : Avers.Operation[] = [];


        constructor(public objectId: string) {}
    }


    function withEditable(h: Handle, objId: string, f: (obj: Editable<any>) => void):void {
        let obj = h.objectCache.get(objId);
        if (obj) { f(obj); }
    }



    // IEntity
    // -----------------------------------------------------------------------
    //
    // Our uniform representation of an object that can be fetched or
    // synchronized with the server.

    interface IEntity {
        status         : Status;
        networkRequest : NetworkRequest;
    }

    // The concrete implementations which are managed by the 'Handle'.
    type Entity = Editable<any> | Static<any>;


    function lookupE<T>(h: Handle, e: Entity): Entity {
        if (e instanceof Editable) {
            return h.objectCache.get(e.objectId);
        } else if (e instanceof Static) {
            return lookupStatic<T>(h, e.ns, e.key);
        }
    }



    // runNetworkRequest
    // -----------------------------------------------------------------------
    //
    // Run a network request attached to the given 'Entity'. This overwrites
    // (invalidates) any currently running request. The promise is resolved only
    // when the request is still valid. That is when you can handle the response
    // and apply changes to the Handle.

    function
    runNetworkRequest<T, R>
    ( h       : Handle
    , entity  : Entity
    , modifyE : (h: Handle, f: (e: Entity) => void) => void
    , req     : Promise<R>
    ): Promise<R> {
        let nr = new NetworkRequest(h.now(), req);

        modifyHandle(h, mkAction(`attachNetworkRequest()`, h => {
            modifyE(h, e => { e.networkRequest = nr; });
        }));

        return req.then(res => {
            let e = lookupE(h, entity);
            if (e && e.networkRequest === nr) {
                modifyHandle(h, mkAction(`clearNetworkRequest()`, h => {
                    modifyE(h, e => { e.networkRequest = undefined; });
                }));

                return res;

            } else {
                throw new Error('runNetworkRequest: not current anymore');
            }
        });
    }


    // loadEditable
    // -----------------------------------------------------------------------
    //
    // Fetch an object from the server and initialize the Editable with the
    // response.

    export function
    loadEditable<T>(h: Handle, obj: Editable<T>): Promise<void> {
        let objId = obj.objectId;

        function modifyE(h, f) {
            withEditable(h, objId, f);
        }

        return runNetworkRequest(h, obj, modifyE, fetchObject(h, objId)).then(json => {
            resolveEditable<T>(h, obj, json);
        }).catch(e => {
            modifyHandle(h, mkAction(`loadFailed(EditableE(${obj.objectId}))`, h => {
                withEditable(h, objId, obj => { obj.status = Status.Failed; });
            }));

            throw e;
        });
    }


    // fetchObject
    // -----------------------------------------------------------------------
    //
    // Fetch the raw JSON of an object from the server.

    export function
    fetchObject(h: Handle, id: string): Promise<any> {
        let url = endpointUrl(h, '/objects/' + id);
        return h.fetch(url, { credentials: 'include' }).then(res => {
            if (res.status === 200) {
                return res.json();
            } else {
                throw new Error('Avers.fetchObject: status ' + res.status);
            }
        });
    }



    export function
    createObject(h: Handle, type: string, content): Promise<string> {
        let url  = endpointUrl(h, '/objects')
          , body = JSON.stringify({ type: type, content: content });

        return h.fetch(url, { credentials: 'include', method: 'POST', body: body }).then(res => {
            return res.json().then(json => {
                startNextGeneration(h);
                return json.id;
            });
        });
    }


    export function
    createObjectId
    ( h     : Handle
    , objId : string
    , type  : string
    , content
    ): Promise<{}> {
        let url  = endpointUrl(h, '/objects/' + objId)
          , body = JSON.stringify({ type: type, content: content });

        return h.fetch(url, { credentials: 'include', method: 'POST', body: body }).then(res => {
            return res.json().then(json => {
                startNextGeneration(h);
                return {};
            });
        });
    }


    export function
    deleteObject(h: Handle, id: string): Promise<void> {
        let url = endpointUrl(h, '/objects/' + id);
        return h.fetch(url, { credentials: 'include', method: 'DELETE' }).then(res => {
            console.log('Deleted', id, res.status);
            startNextGeneration(h);
        });
    }

    function initContent(h: Handle, obj: Editable<any>): void {
        obj.content = Avers.clone(obj.shadowContent);

        [].concat(obj.submittedChanges, obj.localChanges).forEach(o => {
            Avers.applyOperation(obj.content, o.path, o);
        });

        Avers.deliverChangeRecords(obj.content);
        Avers.attachChangeListener(obj.content, mkChangeListener(h, obj));
    }

    function
    resolveEditable<T>(h: Handle, obj: Editable<T>, body): void {
        modifyHandle(h, mkAction(`resolveEditable(${obj.objectId})`, h => {
            withEditable(h, obj.objectId, obj => {
                obj.status         = Status.Loaded;

                obj.type           = body.type;
                obj.objectId       = body.id;
                obj.createdAt      = new Date(Date.parse(body.createdAt));
                obj.createdBy      = body.createdBy;
                obj.revisionId     = body.revisionId || 0;

                obj.shadowContent  = Avers.parseJSON<T>(h.infoTable.get(obj.type), body.content);
                Avers.deliverChangeRecords(obj.shadowContent);

                initContent(h, obj);
                Avers.migrateObject(obj.content);
            });
        }));
    }


    function
    mkChangeListener<T>
    ( h   : Handle
    , obj : Editable<T>
    ): (changes: Avers.Change<any>[]) => void {
        let save: any = debounce(saveEditable, 1500);

        return function onChange(changes: Avers.Change<any>[]): void {
            let ops = changes.map(Avers.changeOperation);

            modifyHandle(h, mkAction(`captureChanges(${obj.objectId},${ops.length})`, h => {
                withEditable(h, obj.objectId, obj => {
                    obj.localChanges = obj.localChanges.concat(ops);
                    initContent(h, obj);
                });
            }));

            save(h, obj);
        };
    }


    export function
    saveEditable<T>(h: Handle, obj: Editable<T>): void {
        let objId = obj.objectId;

        // ASSERT obj.status === Status.Loaded

        // Guard on not having a request in flight. If this editable has any
        // local changes, they will be submitted when the request finishes.
        if (obj.submittedChanges.length > 0) {
            return;
        }

        // Guard on having some local changes which we can save.
        if (obj.localChanges.length === 0) {
            return;
        }


        let data = JSON.stringify(
            { objectId       : obj.objectId
            , revisionId     : obj.revisionId
            , operations     : filterOps(obj.localChanges)
            }
        );


        // We immeadiately mark the Editable as being saved. This ensures that
        // any future attempts to save the editable are skipped.
        modifyHandle(h, mkAction(`prepareLocalChanges(${obj.objectId})`, h => {
            withEditable(h, obj.objectId, obj => {
                obj.submittedChanges = obj.localChanges;
                obj.localChanges     = [];
            });
        }));


        let url = endpointUrl(h, '/objects/' + obj.objectId);
        let req = h.fetch(url, { credentials: 'include', method: 'PATCH', body: data }).then(res => {
            if (res.status === 200) {
                return res.json();
            } else {
                throw new Error('Avers.saveEditable: status ' + res.status);
            }
        });

        function modifyE(h, f) {
            withEditable(h, objId, f);
        }

        runNetworkRequest(h, obj, modifyE, req).then(body => {
            console.log(
                [ 'Saved '
                , body.resultingPatches.length
                , ' operations on '
                , obj.objectId
                , ' ('
                , body.previousPatches.length
                , ' previous patches)'
                ].join('')
            );


            // Apply all server patches to the shadow content, to bring it up
            // to date WRT the server version. Also bump the revisionId to
            // reflect what the server has.

            modifyHandle(h, mkAction(`applyServerResponse(${obj.objectId})`, h => {
                // Clear out any traces that we've submitted changes to the
                // server.
                obj.submittedChanges = [];


                // Apply patches which the server sent us to the shadow content.
                let serverPatches = [].concat(body.previousPatches, body.resultingPatches);

                obj.revisionId += serverPatches.length;
                serverPatches.forEach(patch => {
                    let op = patch.operation;
                    Avers.applyOperation(obj.shadowContent, op.path, op);
                });


                // Re-initialize the local content.
                initContent(h, obj);
            }));

            // See if we have any more local changes which we need to save.
            saveEditable(h, obj);

        }).catch(err => {
            // The server would presumably respond with changes which
            // were submitted before us, and we'd have to rebase our
            // changes on top of that.

            modifyHandle(h, mkAction(`restoreLocalChanges(${obj.objectId})`, h => {
                withEditable(h, obj.objectId, obj => {
                    obj.localChanges     = obj.submittedChanges.concat(obj.localChanges);
                    obj.submittedChanges = [];
                });
            }));
        });
    }


    // Filter out subsequent operations which touch the same path.
    function filterOps(ops: Avers.Operation[]): Avers.Operation[] {
        return ops.reduce((a: Avers.Operation[], op: Avers.Operation): Avers.Operation[] => {
            let lastOp = a[a.length - 1];

            if (lastOp && lastOp.path === op.path && lastOp.type === 'set') {
                a[a.length - 1] = op;
            } else {
                a.push(op);
            }

            return a;
        }, []);
    }


    export class ObjectCollection {

        fetchedAt : number;
        url       : string;
        objectIds : string[];

        constructor
          ( public h              : Handle
          , public collectionName : string
          ) {
            this.fetchedAt = 0;
            this.url       = endpointUrl(h, '/collection/' + collectionName);
            this.objectIds = undefined;
        }

        private mergeIds(ids: string[]): void {
            let isChanged = this.objectIds === undefined || ids.length !== this.objectIds.length ||
                ids.reduce((a, id, index) => {
                    return a || id !== this.objectIds[index];
                }, false);

            if (isChanged) {
                modifyHandle(this.h, mkAction(`updateObjectCollection(${this.collectionName})`, () => {
                    this.objectIds = ids;
                }));
            }
        }

        private fetch(): void {
            let now = Date.now();
            if (now - this.fetchedAt > 10 * 1000) {
                this.fetchedAt = now;

                this.h.fetch(this.url, { credentials: 'include' }).then(res => {
                    return res.json().then(json => {
                        this.mergeIds(json);
                    });
                }).catch(err => {
                    console.error('Avers.Collection fetch', err);
                });
            }
        }

        get ids(): Computation<string[]> {
            this.fetch();
            return new Computation(() => {
                if (this.objectIds === undefined) {
                    return Computation.Pending;
                } else {
                    return this.objectIds;
                }
            });
        }
    }


    export function
    resetObjectCollection(c: ObjectCollection): void {
        modifyHandle(c.h, mkAction(`resetObjectCollection(${c.collectionName})`, h => {
            c.fetchedAt = 0;
        }));
    }


    export class KeyedObjectCollection<T> {

        cache = new Map<string, ObjectCollection>();

        constructor
          ( public h     : Handle
          , public keyFn : (key: T) => string
          ) {}

        get(keyInput: T): ObjectCollection {
            let key        = this.keyFn(keyInput)
              , collection = this.cache.get(key);

            if (!collection) {
                collection = new ObjectCollection(this.h, key);
                this.cache.set(key, collection);
            }

            return collection;
        }
    }


    export function
    resetKeyedObjectCollection(kc: KeyedObjectCollection<any>): void {
        kc.cache.forEach(c => {
            resetObjectCollection(c);
        });
    }



    // Static<T>
    // -----------------------------------------------------------------------
    //
    // A static value which is read-only. Is loaded from the server when
    // required, then cached indefinitely (or until pruned from the cache).
    // The objects are managed by the Avers Handle, they trigger a generation
    // change when they are modified.

    export class Static<T> {

        status         : Status         = Status.Empty;
        networkRequest : NetworkRequest = undefined;
        value          : T              = undefined;

        constructor
          ( public ns    : Symbol
          , public key   : string
          , public fetch : () => Promise<T>
          ) {}
    }


    // mkStatic
    // -----------------------------------------------------------------------
    //
    // Even though this function has access to the 'Handle' and indeed modifies
    // it, the changes have has no externally observable effect.

    export function
    mkStatic<T>
    ( h     : Handle
    , ns    : Symbol
    , key   : string
    , fetch : () => Promise<T>
    ): Static<T> {
        let n = h.staticCache.get(ns);
        if (!n) {
            n = new Map<string, Static<any>>();
            h.staticCache.set(ns, n);
        }

        let x = n.get(key);
        if (!x) {
            x = new Static(ns, key, fetch);
            n.set(key, x);
        }

        return x;
    }



    // staticValue
    // -----------------------------------------------------------------------
    //
    // Extract the value from the Static as a Computation. If the value is not
    // loaded yet, then a request will be sent to the server to fetch it.

    export function
    staticValue<T>(h: Handle, s: Static<T>): Computation<T> {
        return new Computation(() => {
            loadStatic(h, s);

            if (s.value === undefined) {
                return Computation.Pending;
            } else {
                return s.value;
            }
        });
    }



    // loadStatic
    // -----------------------------------------------------------------------
    //
    // Internal function which is used to initiate the fetch if required.
    //
    // FIXME: Retry the request if the promise failed.


    function lookupStatic<T>(h: Handle, ns: Symbol, key: string): Static<T> {
        let n = h.staticCache.get(ns);
        if (n) { return n.get(key); }
    }

    function withStatic(h: Handle, x: Static<any>, f: (s: Static<any>) => void): void {
        let s = lookupStatic<any>(h, x.ns, x.key);
        if (s) { f(s); }
    }

    function
    loadStatic<T>(h: Handle, s: Static<T>): void {
        if (s.status === Status.Empty && s.networkRequest === undefined) {

            function modifyE(h, f) { withStatic(h, s, f); }
            runNetworkRequest(h, s, modifyE, s.fetch()).then(v => {
                modifyHandle(h, mkAction(`resolveStatic(${s.ns}, ${s.key})`, () => {
                    withStatic(h, s, s => {
                        s.status = Status.Loaded;
                        s.value  = v;
                    });
                }));

            }).catch(err => {
                modifyHandle(h, mkAction(`loadFailed(StaticE(${s.ns}, ${s.key}))`, () => {
                    withStatic(h, s, s => {
                        s.status = Status.Failed;
                    });
                }));
            });
        }
    }


    // Patch
    // -----------------------------------------------------------------------
    //
    // Patches are read-only on the client.

    export class Patch {
        constructor
          ( public objectId   : string
          , public revisionId : number
          , public authorId   : string
          , public createdAt  : string
          , public operation  : Operation
          ) {}
    }



    export function
    fetchPatch(h: Handle, objectId: string, revId: number): Promise<Patch> {
        let url = endpointUrl(h, '/objects/' + objectId + '/patches/' + revId);
        return h.fetch(url, { credentials: 'include' }).then(res => {
            if (res.status === 200) {
                return res.json().then(json => {
                    return new Patch
                        ( json.objectId
                        , json.revisionId
                        , json.authorId
                        , json.createdAt
                        , json.operation
                        );
                });
            } else {
                throw new Error('Avers.fetchPatch: status ' + res.status);
            }
        });
    }


    function
    mkPatch(h: Handle, objectId: string, revId: number): Static<Patch> {
        let key = objectId + '@' + revId;

        return mkStatic<Patch>(h, aversNamespace, key, () => {
            return fetchPatch(h, objectId, revId);
        });
    }


    // lookupPatch
    // -----------------------------------------------------------------------
    //
    // Get an patch by its identifier (objectId + revId). This computation is
    // pending until the patch has been fetched from the server.

    export function
    lookupPatch(h: Handle, objectId: string, revId: number): Computation<Patch> {
        return staticValue(h, mkPatch(h, objectId, revId));
    }
}
