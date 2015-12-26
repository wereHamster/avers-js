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


import Computation from 'computation';

import { immutableClone } from './shared';
import { applyOperation, Operation, deliverChangeRecords, Change,
    changeOperation, parseJSON, migrateObject, attachChangeListener,
    detachChangeListener } from './core';



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

    objectCache    = new Map<string, Editable<any>>();
    staticCache    = new Map<Symbol, Map<string, StaticE<any>>>();
    ephemeralCache = new Map<Symbol, Map<string, EphemeralE<any>>>();

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
    // Removing Object.observe, will have to be replaced with explicit callbacks.
    //
    // (<any>Object).getNotifier(h).notify({
    //     type: 'Avers::Action', action: act
    // });

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

export function
mkEditable<T>(h: Handle, id: string): Editable<T> {
    let obj = h.objectCache.get(id);
    if (!obj) {
        obj = new Editable<T>(id);
        h.objectCache.set(id, Object.freeze(obj));
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
                if (obj.networkRequest === undefined) {
                    loadEditable(h, obj);
                }

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

            if (obj.content !== undefined) {
                resolve(obj);
            } else if (obj.lastError !== undefined) {
                reject();
            } else {
                let nr  = obj.networkRequest
                  , req = nr ? nr.promise : loadEditable(h, obj);

                req.then(check).catch(check);
            }
        })();
    });
}



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


    lastError : Error = undefined;


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
    changeListener   : any;

    submittedChanges : Operation[] = [];
    localChanges     : Operation[] = [];


    constructor(public objectId: string) {}
}


function
withEditable(h: Handle, objId: string, f: (obj: Editable<any>) => void): void {
    let obj = h.objectCache.get(objId);
    if (obj) { applyEditableChanges(h, obj, f); }
}



// updateEditable
// -----------------------------------------------------------------------
//
// A non-destructive update of an 'Editable'. The callback is given a copy
// of the original and can set any properties on it. The copy is then
// inserted into the cache.
//
// If the 'Editable' doesn't exist in the cache then it is created.

function
updateEditable(h: Handle, objId: string, f: (obj: Editable<any>) => void): void {
    let obj = mkEditable(h, objId);
    applyEditableChanges(h, obj, f);
}



// applyEditableChanges
// -----------------------------------------------------------------------
//
// Create a copy of the given 'Editable', apply the function on it, and insert
// the new copy into the cache, overwriting the previous object.

function
applyEditableChanges(h: Handle, obj: Editable<any>, f: (obj: Editable<any>) => void): void {
    h.objectCache.set(obj.objectId, immutableClone(obj, f));
}



// IEntity
// -----------------------------------------------------------------------
//
// Our uniform representation of an object that can be fetched or
// synchronized with the server.

interface IEntity {
    networkRequest : NetworkRequest;
    lastError      : Error;
}

// The concrete types of IEntity which can be managed by the 'Handle'.
type Entity = Editable<any> | StaticE<any> | EphemeralE<any>;



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
, lookupE : (h: Handle) => Entity
, modifyE : (h: Handle, f: (e: Entity) => void) => void
, req     : Promise<R>
): Promise<{ networkRequest: NetworkRequest, res: R }> {
    let nr = new NetworkRequest(h.now(), req);

    modifyHandle(h, mkAction(`attachNetworkRequest()`, h => {
        modifyE(h, e => { e.networkRequest = nr; });
    }));

    return req.then(res => {
        return { networkRequest: nr, res };
    }).catch(err => {
        let e = lookupE(h);
        if (e && e.networkRequest === nr) {
            modifyHandle(h, mkAction(`reportNetworkFailure(${err})`, h => {
                modifyE(h, e => {
                    e.networkRequest = undefined;
                    e.lastError      = err;
                });
            }));
        }

        return err;
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

    function lookupE(h) { return h.objectCache.get(objId); }
    function modifyE(h, f) { withEditable(h, objId, f); }

    return runNetworkRequest(h, lookupE, modifyE, fetchObject(h, objId)).then(res => {
        let e = lookupE(h);
        if (e && e.networkRequest === res.networkRequest) {
            resolveEditable<T>(h, objId, res.res);
        }
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
    if (obj.content && obj.changeListener) {
        detachChangeListener(obj.content, obj.changeListener);
    }

    obj.content = [].concat(obj.submittedChanges, obj.localChanges).reduce((c, o) => {
        return applyOperation(c, o.path, o);
    }, obj.shadowContent);

    deliverChangeRecords(obj.content);

    obj.changeListener = mkChangeListener(h, obj.objectId);
    attachChangeListener(obj.content, obj.changeListener);
}



// resolveEditable
// -----------------------------------------------------------------------
//
// Given a response from the server, initialize an 'Editable' with the data.
//
// Note that this will invalidate any currently running network requests and
// drop any local changes.

export function
resolveEditable<T>(h: Handle, objId: string, json): void {
    modifyHandle(h, mkAction(`resolveEditable(${objId})`, h => {
        updateEditable(h, objId, obj => {
            obj.networkRequest = undefined;
            obj.lastError      = undefined;

            obj.type           = json.type;
            obj.objectId       = json.id;
            obj.createdAt      = new Date(Date.parse(json.createdAt));
            obj.createdBy      = json.createdBy;
            obj.revisionId     = json.revisionId || 0;

            obj.shadowContent  = parseJSON<T>(h.infoTable.get(obj.type), json.content);
            deliverChangeRecords(obj.shadowContent);

            obj.submittedChanges = [];
            obj.localChanges     = [];

            initContent(h, obj);
            migrateObject(obj.content);
        });
    }));
}



function
mkChangeListener<T>(h: Handle, objId: string): (changes: Change<any>[]) => void {
    let save: any = debounce(saveEditable, 1500);

    return function onChange(changes: Change<any>[]): void {
        let ops = changes.map(changeOperation);

        modifyHandle(h, mkAction(`captureChanges(${objId},${ops.length})`, h => {
            withEditable(h, objId, obj => {
                obj.localChanges = obj.localChanges.concat(ops);
                initContent(h, obj);
            });
        }));

        save(h, objId);
    };
}


function
saveEditable(h: Handle, objId: string): void {
    let obj = h.objectCache.get(objId);
    if (!obj) { return; }

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


    let url = endpointUrl(h, '/objects/' + objId);
    let req = h.fetch(url, { credentials: 'include', method: 'PATCH', body: data }).then(res => {
        if (res.status === 200) {
            return res.json();
        } else {
            throw new Error('Avers.saveEditable: status ' + res.status);
        }
    });

    function lookupE(h) { return h.objectCache.get(objId); }
    function modifyE(h, f) { withEditable(h, objId, f); }

    runNetworkRequest(h, lookupE, modifyE, req).then(res => {
        // We ignore whether the response is from the current NetworkRequest
        // or not. It's irrelevant, upon receeiving a successful response
        // from the server the changes have been stored in the database,
        // and there is no way back. We have no choice than to accept the
        // changes and apply to the local state.

        let body = res.res;

        console.log(
            [ 'Saved '
            , body.resultingPatches.length
            , ' operations on '
            , objId
            , ' ('
            , body.previousPatches.length
            , ' previous patches)'
            ].join('')
        );


        // Apply all server patches to the shadow content, to bring it up
        // to date WRT the server version. Also bump the revisionId to
        // reflect what the server has.

        modifyHandle(h, mkAction(`applyServerResponse(${objId})`, h => {
            withEditable(h, objId, obj => {
                if (obj.networkRequest === res.networkRequest) {
                    obj.networkRequest = undefined;
                }

                // Clear out any traces that we've submitted changes to the
                // server.
                obj.submittedChanges = [];


                // Apply patches which the server sent us to the shadow content.
                let serverPatches = [].concat(body.previousPatches, body.resultingPatches);

                obj.revisionId += serverPatches.length;
                obj.shadowContent = serverPatches.reduce((c, patch) => {
                    let op = patch.operation;
                    return applyOperation(c, op.path, op);
                }, obj.shadowContent);


                // Re-initialize the local content.
                initContent(h, obj);
            });
        }));

        // See if we have any more local changes which we need to save.
        saveEditable(h, objId);

    }).catch(err => {
        // The server would presumably respond with changes which
        // were submitted before us, and we'd have to rebase our
        // changes on top of that.

        modifyHandle(h, mkAction(`restoreLocalChanges(${obj.objectId})`, h => {
            withEditable(h, objId, obj => {
                obj.localChanges     = obj.submittedChanges.concat(obj.localChanges);
                obj.submittedChanges = [];
            });
        }));
    });
}


// Filter out subsequent operations which touch the same path.
function filterOps(ops: Operation[]): Operation[] {
    return ops.reduce((a: Operation[], op: Operation): Operation[] => {
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

    networkRequest : NetworkRequest = undefined;
    lastError      : Error          = undefined;
    value          : T              = undefined;

    constructor
      ( public ns    : Symbol
      , public key   : string
      , public fetch : () => Promise<T>
      ) {}
}

export class StaticE<T> {
    networkRequest : NetworkRequest = undefined;
    lastError      : Error          = undefined;
    value          : T              = undefined;
}


function lookupStaticE<T>(h: Handle, ns: Symbol, key: string): StaticE<T> {
    let n = h.staticCache.get(ns);
    if (n) { return n.get(key); }
}


function insertStaticE(h: Handle, ns: Symbol, key: string, e: StaticE<any>): void {
    let n = h.staticCache.get(ns);
    if (!n) {
        n = new Map<string, StaticE<any>>();
        h.staticCache.set(ns, n);
    }

    n.set(key, Object.freeze(e));
}


function
applyStaticChanges<T>(h: Handle, ns: Symbol, key: string, s: StaticE<T>, f: (s: StaticE<T>) => void): void {
    insertStaticE(h, ns, key, immutableClone(s, f));
}


function withStaticE(h: Handle, ns: Symbol, key: string, f: (s: StaticE<any>) => void): void {
    applyStaticChanges(h, ns, key, mkStaticE<any>(h, ns, key), f);
}



// mkStatic
// -----------------------------------------------------------------------
//
// Even though this function has access to the 'Handle' and indeed modifies
// it, the changes have has no externally observable effect.

function
mkStaticE<T>(h: Handle, ns: Symbol, key: string): StaticE<T> {
    let n = h.staticCache.get(ns);
    if (!n) {
        n = new Map<string, Static<any>>();
        h.staticCache.set(ns, n);
    }

    let s = n.get(key);
    if (!s) {
        s = new StaticE<T>();
        insertStaticE(h, ns, key, s);
    }

    return s;
}



// staticValue
// -----------------------------------------------------------------------
//
// Extract the value from the Static as a Computation. If the value is not
// loaded yet, then a request will be sent to the server to fetch it.

export function
staticValue<T>(h: Handle, s: Static<T>): Computation<T> {
    return new Computation(() => {
        let ent = mkStaticE<T>(h, s.ns, s.key);

        refreshStatic(h, s, ent);

        if (ent.value === undefined) {
            return Computation.Pending;
        } else {
            return ent.value;
        }
    });
}



// refreshStatic
// -----------------------------------------------------------------------
//
// Internal function which is used to initiate the fetch if required.
//
// FIXME: Retry the request if the promise failed.

function
refreshStatic<T>(h: Handle, s: Static<T>, ent: StaticE<T>): void {
    if (ent.value === undefined && ent.networkRequest === undefined) {

        function lookupE(h) { return lookupStaticE(h, s.ns, s.key); }
        function modifyE(h, f) { withStaticE(h, s.ns, s.key, f); }

        runNetworkRequest(h, lookupE, modifyE, s.fetch()).then(res => {
            resolveStatic(h, s, res.res);
        });
    }
}


export function
resolveStatic<T>(h: Handle, s: Static<T>, value: T): void {
    modifyHandle(h, mkAction(`resolveStatic(${s.ns.toString()}, ${s.key})`, h => {
        withStaticE(h, s.ns, s.key, e => {
            e.networkRequest = undefined;
            e.lastError      = undefined;

            e.value          = value;
        });
    }));
}





// Ephemeral<T>
// -----------------------------------------------------------------------
//
// Ephemeral<T> objects are similar to Static<T> in that they can't be
// modified, but they can expire and become stale. Once stale they are
// re-fetched.

export class Ephemeral<T> {
    constructor
      ( public ns    : Symbol
      , public key   : string
      , public fetch : () => Promise<{ value: T, expiresAt: number }>
      ) {}
}


// EphemeralE<T>
// ------------------------------------------------------------------------
//
// The internal object for an Ephemeral<T> which stores the actual value and
// keeps track of the network interaction.
//
// This is an internal class. It is not exposed through any public API, except
// through the 'ephemeralCache' in the Handle.

export class EphemeralE<T> {

    networkRequest : NetworkRequest = undefined;
    lastError      : Error          = undefined;
    value          : T              = undefined;

    expiresAt      : number         = 0;
}


function lookupEphemeralE<T>(h: Handle, ns: Symbol, key: string): EphemeralE<T> {
    let n = h.ephemeralCache.get(ns);
    if (n) { return n.get(key); }
}


function insertEphemeralE(h: Handle, ns: Symbol, key: string, e: EphemeralE<any>): void {
    let n = h.ephemeralCache.get(ns);
    if (!n) {
        n = new Map<string, EphemeralE<any>>();
        h.ephemeralCache.set(ns, n);
    }

    n.set(key, Object.freeze(e));
}


function
applyEphemeralChanges<T>(h: Handle, ns: Symbol, key: string, s: EphemeralE<T>, f: (s: EphemeralE<T>) => void): void {
    insertEphemeralE(h, ns, key, immutableClone(s, f));
}


function withEphemeralE(h: Handle, ns: Symbol, key: string, f: (s: EphemeralE<any>) => void): void {
    applyEphemeralChanges(h, ns, key, mkEphemeralE<any>(h, ns, key), f);
}



// mkEphemeralE
// -----------------------------------------------------------------------

function
mkEphemeralE<T>(h: Handle , ns: Symbol, key: string): EphemeralE<T> {
    let e = lookupEphemeralE<T>(h, ns, key);
    if (!e) {
        e = new EphemeralE<T>();
        insertEphemeralE(h, ns, key, e);
    }

    return e;
}



// ephemeralValue
// -----------------------------------------------------------------------
//
// Extract the value from the Static as a Computation. If the value is not
// loaded yet, then a request will be sent to the server to fetch it.

export function
ephemeralValue<T>(h: Handle, e: Ephemeral<T>): Computation<T> {
    return new Computation(() => {
        let ent = mkEphemeralE<T>(h, e.ns, e.key);

        refreshEphemeral<T>(h, e, ent);

        if (ent.value === undefined) {
            return Computation.Pending;
        } else {
            return ent.value;
        }
    });
}



// refreshEphemeral
// -----------------------------------------------------------------------
//
// Internal function which is used to initiate the fetch if required.
//
// FIXME: Retry the request if the promise failed.

function
refreshEphemeral<T>(h: Handle, e: Ephemeral<T>, ent: EphemeralE<T>): void {
    let now = h.now();
    if ((ent.value === undefined || now > ent.expiresAt) && ent.networkRequest === undefined) {

        function lookupE(h) { return lookupEphemeralE(h, e.ns, e.key); }
        function modifyE(h, f) { withEphemeralE(h, e.ns, e.key, f); }

        runNetworkRequest(h, lookupE, modifyE, e.fetch()).then(res => {
            resolveEphemeral(h, e, res.res.value, res.res.expiresAt);
        });
    }
}



// resolveEphemeral<T>
// -----------------------------------------------------------------------
//
// This function is used when we receive the response from the Ephemeral<T>
// fetch function. This is exported to allow users to simulate these responses
// without actually hitting the network.

export function
resolveEphemeral<T>
( h         : Handle
, e         : Ephemeral<T>
, value     : T
, expiresAt : number
): void {
    modifyHandle(h, mkAction(`resolveEphemeral(${e.ns.toString()}, ${e.key})`, h => {
        withEphemeralE(h, e.ns, e.key, e => {
            e.networkRequest = undefined;
            e.lastError      = undefined;

            e.value          = value;
            e.expiresAt      = expiresAt;
        });
    }));
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

    return new Static<Patch>(aversNamespace, key, () => {
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
