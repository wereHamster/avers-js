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
        patchCache  = new Map<string, Static<Patch>>();

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


    export function startNextGeneration(h: Handle): void {
        h.generationNumber++;
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
            loadEditable(h, obj);

            h.objectCache.set(id, obj);
            startNextGeneration(h);
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
            function await(obj) {
                if (obj.status === Status.Loaded) {
                    resolve(obj);
                } else if (obj.status === Status.Failed) {
                    reject();
                } else {
                    let nr  = obj.networkRequest
                      , req = nr ? nr.promise : loadEditable(h, obj);

                    req.then(() => { await(obj); }).catch(() => { await(obj); });
                }
            }

            await(mkEditable(h, id));
        });
    }





    export enum Status { Empty, Loading, Loaded, Failed }

    function debounce(func, wait, immediate = undefined) {
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

        return function() {
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


    // runNetworkRequest
    // -----------------------------------------------------------------------
    //
    // Run a network request attached to the given 'Editable'. This overwrites
    // (invalidates) any currently running request. The callback is invoked
    // only when the request is still valid.
    //
    // Note: The callback MUST NOT throw exceptions.

    function
    runNetworkRequest<T, R>
    ( h   : Handle
    , obj : Editable<T>
    , req : Promise<R>
    ): Promise<R> {
        let nr = new NetworkRequest(h.now(), req);
        obj.networkRequest = nr;

        startNextGeneration(h);

        return req.then(res => {
            if (obj.networkRequest === nr) {
                obj.networkRequest = undefined;
                startNextGeneration(h);

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
        obj.status = Status.Loading;
        startNextGeneration(h);

        return runNetworkRequest(h, obj, fetchObject(h, obj.objectId)).then(json => {
            try {
                resolveEditable<T>(h, obj, json);
            } catch(e) {
                obj.status = Status.Failed;
            }

            startNextGeneration(h);
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

    function
    resolveEditable<T>(h: Handle, obj: Editable<T>, body): void {
        obj.status         = Status.Loaded;

        obj.type           = body.type;
        obj.objectId       = body.id;
        obj.createdAt      = new Date(Date.parse(body.createdAt));
        obj.createdBy      = body.createdBy;
        obj.revisionId     = body.revisionId || 0;

        let ctor           = h.infoTable.get(obj.type);
        obj.content        = Avers.parseJSON<T>(ctor, body.content);
        obj.shadowContent  = Avers.parseJSON<T>(ctor, body.content);

        Avers.deliverChangeRecords(obj.content);
        Avers.deliverChangeRecords(obj.shadowContent);

        Avers.attachChangeListener(obj.content, mkChangeListener(h, obj));

        // Save any migrations to the server.
        saveEditable(h, obj);

        Avers.migrateObject(obj.content);

        startNextGeneration(h);
    }


    function
    mkChangeListener<T>
    ( h   : Handle
    , obj : Editable<T>
    ): (changes: Avers.Change<any>[]) => void {
        let save: any = debounce(saveEditable, 1500);

        return function onChange(changes: Avers.Change<any>[]): void {
            changes.forEach(change => {
                let op = Avers.changeOperation(change);
                obj.localChanges.push(op);
            });

            startNextGeneration(h);
            save(h, obj);
        };
    }


    export function
    saveEditable<T>(h: Handle, obj: Editable<T>): void {
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

        obj.submittedChanges = obj.localChanges;
        obj.localChanges     = [];

        startNextGeneration(h);

        let url = endpointUrl(h, '/objects/' + obj.objectId);
        let req = h.fetch(url, { credentials: 'include', method: 'PATCH', body: data }).then(res => {
            if (res.status === 200) {
                return res.json();
            } else {
                throw new Error('Avers.saveEditable: status ' + res.status);
            }
        });

        runNetworkRequest(h, obj, req).then(body => {
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

            let serverPatches = [].concat(body.previousPatches, body.resultingPatches);

            obj.revisionId += serverPatches.length;
            serverPatches.forEach(patch => {
                let op = patch.operation;
                Avers.applyOperation(obj.shadowContent, op.path, op);
            });


            // Clone the server version and apply any local changes which the
            // client has created since submitting.
            obj.content = Avers.clone(obj.shadowContent);
            obj.localChanges.forEach(op => {
                Avers.applyOperation(obj.content, op.path, op);
            });


            // Flush change records and attach a change listener to the new
            // content.
            Avers.deliverChangeRecords(obj.content);
            Avers.attachChangeListener(obj.content, mkChangeListener(h, obj));


            // Clear out any traces that we've submitted changes to the
            // server.
            obj.submittedChanges = [];


            // See if we have any more local changes which we need to save.
            saveEditable(h, obj);

        }).catch(err => {
            // The server would presumably respond with changes which
            // were submitted before us, and we'd have to rebase our
            // changes on top of that.

            obj.localChanges     = obj.submittedChanges.concat(obj.localChanges);
            obj.submittedChanges = [];

        }).then(() => {
            startNextGeneration(h);
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
                this.objectIds = ids;
                startNextGeneration(this.h);
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
        c.fetchedAt = 0;
        startNextGeneration(c.h);
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

        status : Status = Status.Empty;
        value  : T      = undefined;

        constructor
          ( public fetch : () => Promise<T>
          ) {}
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

    function
    loadStatic<T>(h: Handle, s: Static<T>): void {
        if (s.status === Status.Empty) {
            s.status = Status.Loading;
            startNextGeneration(h);

            s.fetch().then(v => {
                s.status = Status.Loaded;
                s.value  = v;

            }).catch(err => {
                s.status = Status.Failed;

            }).then(() => {
                startNextGeneration(h);
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
        let key = objectId + '@' + revId
          , s   = h.patchCache.get(key);

        if (!s) {
            s = new Static<Patch>(() => {
                return fetchPatch(h, objectId, revId);
            });

            h.patchCache.set(key, s);
            startNextGeneration(h);
        }

        return s;
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
