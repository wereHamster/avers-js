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

        constructor
          ( public apiHost : string
            // ^ The hostname where we can reach the Avers API server. Leave
            // out the trailing slash.
            //
            // Example: "//localhost:8000"

          , public fetch : Fetch
            // ^ API to send network requests. If you use this extension in
            // a web browser, you can pass in the 'fetch' function directly.

          , public infoTable : Map<string, ObjectConstructor<any>>
            // ^ All object types which the client can parse.

          ) {}
    }


    function startNextGeneration(h: Handle): void {
        h.generationNumber++;
    }


    function
    endpointUrl(h: Handle, path: string): string {
        return h.apiHost + path;
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
                    var req = obj.networkRequest || loadEditable(h, obj);
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


    export class Editable<T> {

        status : Status = Status.Empty;


        networkRequest : Promise<{}> = undefined;

        // ^ If we have a active network request at the moment (either to
        // fetch the object or saving changes etc) then this is the promise of
        // that request.
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

    function
    runNetworkRequest<T, R>
    ( obj : Editable<T>
    , req : Promise<R>
    , fn  : (res: R) => void
    ): Promise<void> {
        obj.networkRequest = req;
        return req.then(res => {
            if (obj.networkRequest === req) {
                obj.networkRequest = undefined;

                fn(res);

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

        return runNetworkRequest(obj, fetchObject(h, obj.objectId), json => {
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
        h.fetch(url, { credentials: 'include', method: 'PATCH', body: data }).then(res => {
            if (res.status === 200) {
                return res.json();
            } else {
                throw new Error('Avers.saveEditable: status ' + res.status);
            }
        }).then(body => {
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

            // numUnsavedChanges -= obj.submittedChanges.length;
            // numSavingEntities--;

            body.previousPatches.forEach(patch => {
                let op = patch.operation;
                Avers.applyOperation(obj.shadowContent, op.path, op);
            });
            body.resultingPatches.forEach(patch => {
                let op = patch.operation;
                Avers.applyOperation(obj.shadowContent, op.path, op);
            });
            obj.localChanges.forEach(op => {
                Avers.applyOperation(obj.shadowContent, op.path, op);
            });

            obj.content = Avers.clone(obj.shadowContent);
            Avers.deliverChangeRecords(obj.content);

            Avers.attachChangeListener(obj.content, mkChangeListener(h, obj));

            obj.revisionId += body.previousPatches.length + body.resultingPatches.length;
            obj.submittedChanges = [];

            saveEditable(h, obj);

        }).catch(err => {
            // The server would presumably respond with changes which
            // were submitted before us, and we'd have to rebase our
            // changes on top of that.

            //numSavingEntities--;

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
            this.objectIds = [];
        }

        private mergeIds(ids: string[]): void {
            let isChanged = ids.length !== this.objectIds.length ||
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
                return this.objectIds;
            });
        }
    }


    export function
    resetObjectCollection(c: ObjectCollection): void {
        c.fetchedAt = 0;
        startNextGeneration(c.h);
    }


    export class KeyedObjectCollection<T> {

        cache : Map<string, ObjectCollection>
            = new Map<string, ObjectCollection>();

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

}
