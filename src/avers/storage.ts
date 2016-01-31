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
import { applyOperation, Operation, Change,
    changeOperation, parseJSON, migrateObject, attachChangeListener,
    detachChangeListener } from './core';



const aversNamespace = Symbol('aversNamespace');


// TODO: Drop this once TypeScript itself provides the definition of the
// W3C Fetch API or find one (eg. DefinitelyTyped) and point users to it.

export interface Fetch {
    (input: string, init?): Promise<any>;
}



// Helpful type synonyms
// -----------------------------------------------------------------------------

export type ObjId = string;
export type RevId = number;




export interface ObjectConstructor<T> {
    new(): T;
}


export class Handle {

    generationNumber = 0;
    // ^ Incremented everytime something managed by this handle changes.

    generationChangeCallbacks: Set<Function> = new Set();
    // ^ List of callbacks which are invoked when the generation changes.

    objectCache    = new Map<string, Editable<any>>();
    staticCache    = new Map<Symbol, Map<string, StaticE<any>>>();
    ephemeralCache = new Map<Symbol, Map<string, EphemeralE<any>>>();

    feedSocket : WebSocket = undefined;
    // ^ A WebSocket connected to the feed through which the client receives
    // change notifications (eg. new patches).


    constructor
      ( public apiHost : string
        // ^ The hostname where we can reach the Avers API server. Leave
        // out the trailing slash.
        //
        // Example: "//localhost:8000"

      , public fetch : Fetch
        // ^ API to send network requests. If you use this extension in
        // a web browser, you can pass in the 'fetch' function directly.

      , public createWebSocket : (path: string) => WebSocket
        // ^ Create a WebSocket connection to the given path.

      , public now : () => number
        // ^ Function which returns the current time. You can use 'Date.now'
        // or 'window.performance.now', depending on how accurate time
        // resolution you need.

      , public infoTable : Map<string, ObjectConstructor<any>>
        // ^ All object types which the client can parse.

      ) {}
}



interface Action<T> {
    label   : string;
    payload : T;
    applyF  : (h: Handle, payload: T) => void;
}

function mkAction<T>(label: string, payload: T, applyF: (h: Handle, payload: T) => void): Action<T> {
    return { label, payload, applyF };
}

function modifyHandle<T>(h: Handle, act: Action<T>): void {
    console.debug('modifyHandle', act.label);

    act.applyF(h, act.payload);
    startNextGeneration(h);
}



export function startNextGeneration(h: Handle): void {
    h.generationNumber++;

    for (let f of h.generationChangeCallbacks.values()) {
        f();
    }
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
    let generationChangeCallback = f.bind(null);
    h.generationChangeCallbacks.add(generationChangeCallback);
    return generationChangeCallback;
}


// detachGenerationListener
// -----------------------------------------------------------------------
//
// Detach a generation listener from the handle. The listener is the value
// you get from 'attachGenerationListener'.

export function
detachGenerationListener(h: Handle, listener: Function): void {
    h.generationChangeCallbacks.delete(listener);
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
        let nr = obj.networkRequest;
        if (nr !== undefined) { ret.push(nr); }
    }

    return ret;
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


// changeFeedSubscription
// -----------------------------------------------------------------------------
//
// Change the feed subscription. Opens the websocket if not already open.

function
changeFeedSubscription(h: Handle, json) {
    if (h.feedSocket === undefined) {
        h.feedSocket = h.createWebSocket('/feed');

        h.feedSocket.addEventListener('message', msg => {
            try {
                applyChange(h, JSON.parse(msg.data));
            } catch (e) {
                console.error('changeFeedSubscription: error when parsing message', e);
            }
        });
    }

    if (h.feedSocket.readyState === WebSocket.OPEN) {
        h.feedSocket.send(JSON.stringify(json));
    } else {
        h.feedSocket.addEventListener('open', function onOpen() {
            h.feedSocket.send(JSON.stringify(json));
            h.feedSocket.removeEventListener('open', onOpen);
        });
    }
}


function
applyChangeF(h: Handle, change): void {
    let {type,content} = change;

    if (type === 'patch') {
        let patch = parsePatch(content);
        updateEditable(h, patch.objectId, obj => {
            applyPatches(obj, [patch]);
            initContent(obj);
        });
    } else {
        console.info('applyChangeF: Unhandled type: ' + type);
    }
}

function
applyChange(h: Handle, change) {
    modifyHandle(h, mkAction(
        `applyChange(${change.type})`,
        change,
        applyChangeF));
}



// applyPatches
// -----------------------------------------------------------------------------
//
// The given patches MUST have consecutive revisionIds!

function
applyPatches(obj: Editable<any>, patches: Patch[]): void {
    if (obj.shadowContent === undefined) {
        // We simply ignore any attempt to apply patches to an Editable which
        // is not resolved.
        //
        // We could store the patches somewhere and attempt to apply them once
        // the Editable is resolved. But that would require careful changes to
        // multiple parts of the code. Given how low the chance is for that to
        // happen and cause problems, we decided to not handle that situation.

        return;
    }

    let applicablePatches = patches.filter(p => p.revisionId > obj.revisionId);
    if (applicablePatches.length === 0 || applicablePatches[0].revisionId !== obj.revisionId + 1) {
        // The first patch is not one that can be applied directly on the
        // Editable. This means there is a gap between the first patche we have
        // and the state of the Editable.
        //
        // We could consider storing the patches somewhere, reload the ones
        // which are missing and then apply them all. But, again, the chance
        // for that to happen is so low that we don't bother.

        return;
    }

    obj.revisionId += applicablePatches.length;
    obj.shadowContent = applicablePatches.reduce((c, patch) => {
        let op = patch.operation;
        return applyOperation(c, op.path, op);
    }, obj.shadowContent);
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
        obj.changeListener = mkChangeListener(h, id);

        h.objectCache.set(id, Object.freeze(obj));

        changeFeedSubscription(h, ['+', id]);
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

    revisionId       : RevId;
    // ^ The RevId as we think is the latest on the server. Local changes
    // are submitted against this RevId.

    shadowContent    : T;
    // ^ The content of the object at 'revisionId'.


    content          : T;
    changeListener   : any;

    submittedChanges : Operation[] = [];
    localChanges     : Operation[] = [];


    constructor(public objectId: ObjId) {}
}


function
withEditable(h: Handle, objId: ObjId, f: (obj: Editable<any>) => void): void {
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
updateEditable(h: Handle, objId: ObjId, f: (obj: Editable<any>) => void): void {
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



// All the entity types which are managed by the Avers Handle.
type Entity = Editable<any> | StaticE<any> | EphemeralE<any>;



// runNetworkRequest
// -----------------------------------------------------------------------
//
// Run a network request attached to the given 'Entity'. This overwrites
// (invalidates) any currently running request. The promise is resolved only
// when the request is still valid. That is when you can handle the response
// and apply changes to the Handle.

function
attachNetworkRequestF(h: Handle, { entity, nr }) {
    function f(e) { e.networkRequest = nr; }

    if (typeof entity === 'string') {
        withEditable(h, entity, f);
    } else if (entity instanceof Static) {
        withStaticE(h, entity.ns, entity.key, f);
    } else if (entity instanceof Ephemeral) {
        withEphemeralE(h, entity.ns, entity.key, f);
    }
}

function
reportNetworkFailureF(h: Handle, { entity, nr, err }) {
    function f(e) {
        if (e.networkRequest === nr) {
            e.networkRequest = undefined;
            e.lastError      = err;
        }
    }

    if (typeof entity === 'string') {
        withEditable(h, entity, f);
    } else if (entity instanceof Static) {
        withStaticE(h, entity.ns, entity.key, f);
    } else if (entity instanceof Ephemeral) {
        withEphemeralE(h, entity.ns, entity.key, f);
    }
}

function entityLabel(entity: string | Static<any> | Ephemeral<any>): string {
    if (typeof entity === 'string') {
        return `Editable(${entity})`;
    } else if (entity instanceof Static) {
        return `Static(${entity.ns.toString()},${entity.key})`;
    } else if (entity instanceof Ephemeral) {
        return `Ephemeral(${entity.ns.toString()},${entity.key})`;
    }
}

function
runNetworkRequest<T, R>
( h       : Handle
, entity  : string | Static<any> | Ephemeral<any>
, req     : Promise<R>
): Promise<{ networkRequest: NetworkRequest, res: R }> {
    let nr = new NetworkRequest(h.now(), req);

    modifyHandle(h, mkAction(
        `attachNetworkRequest(${entityLabel(entity)})`,
        { entity, nr },
        attachNetworkRequestF));

    return req.then(res => {
        return { networkRequest: nr, res };
    }).catch(err => {
        modifyHandle(h, mkAction(
            `reportNetworkFailure(${entityLabel(entity)},${err})`,
            { entity, nr, err },
            reportNetworkFailureF));

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

    return runNetworkRequest(h, objId, fetchObject(h, objId)).then(res => {
        let e = h.objectCache.get(objId);
        if (e && e.networkRequest === res.networkRequest) {
            // FIXME: Clearing the networkRequest from the entity maybe should
            // be a separate action, eg. 'finishNetworkRequest'. Currently it's
            // part of resolveEditable. But that function may be called from
            // somebody else, outside of the context of a network request.

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
    return h.fetch(url, { credentials: 'include', headers: { accept: 'application/json' }}).then(res => {
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

    return h.fetch(url, { credentials: 'include', method: 'POST', body: body, headers: { accept: 'application/json', 'content-type': 'application/json' }}).then(res => {
        return res.json().then(json => {
            startNextGeneration(h);
            return json.id;
        });
    });
}


export function
createObjectId
( h     : Handle
, objId : ObjId
, type  : string
, content
): Promise<{}> {
    let url  = endpointUrl(h, '/objects/' + objId)
      , body = JSON.stringify({ type: type, content: content });

    return h.fetch(url, { credentials: 'include', method: 'POST', body: body, headers: { accept: 'application/json', 'content-type': 'application/json' }}).then(res => {
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

function initContent(obj: Editable<any>): void {
    if (obj.shadowContent === undefined) {
        return;
    }

    if (obj.content) {
        detachChangeListener(obj.content, obj.changeListener);
    }

    obj.content = [].concat(obj.submittedChanges, obj.localChanges).reduce((c, o) => {
        return applyOperation(c, o.path, o);
    }, obj.shadowContent);

    attachChangeListener(obj.content, obj.changeListener);
}



// resolveEditable
// -----------------------------------------------------------------------
//
// Given a response from the server, initialize an 'Editable' with the data.
//
// Note that this will invalidate any currently running network requests and
// drop any local changes.

function
resolveEditableF<T>(h: Handle, { objId, json }) {
    // ASSERT objId === json.id

    updateEditable(h, objId, obj => {
        obj.networkRequest   = undefined;
        obj.lastError        = undefined;

        obj.type             = json.type;
        obj.objectId         = json.id;
        obj.createdAt        = new Date(Date.parse(json.createdAt));
        obj.createdBy        = json.createdBy;
        obj.revisionId       = json.revisionId || 0;

        obj.shadowContent    = parseJSON<T>(h.infoTable.get(obj.type), json.content);

        obj.submittedChanges = [];
        obj.localChanges     = [];

        initContent(obj);
    });

    // This needs to be outside of the 'updateEditable' callback. This
    // function behaves like a user, it may be modifying the content, and
    // recursive invokations of 'updateEditable' are not allowed.
    //
    // When we were using O.o that was not a problem, because change
    // delivery was asynchronous, but Proxy traps are (necessarily)
    // synchronous.
    //
    // The lookup in the cache can not fail, the object is guaranteed
    // to exist. But we are extra cautious and do a check nonetheless.

    let obj = h.objectCache.get(objId);
    if (obj !== undefined) {
        migrateObject(obj.content);
    }
}

export function
resolveEditable<T>(h: Handle, objId: ObjId, json): void {
    modifyHandle(h, mkAction(
        `resolveEditable(${objId})`,
        { objId, json },
        resolveEditableF));
}



function
captureChangesF(h: Handle, { objId, ops }) {
    withEditable(h, objId, obj => {
        obj.localChanges = obj.localChanges.concat(ops);
        initContent(obj);
    });
}


function
mkChangeListener<T>(h: Handle, objId: ObjId): (changes: Change<any>[]) => void {
    let save: any = debounce(saveEditable, 1500);

    return function onChange(changes: Change<any>[]): void {
        let ops = changes.map(changeOperation);

        modifyHandle(h, mkAction(
            `captureChanges(${objId},${ops.length})`,
            { objId, ops },
            captureChangesF));

        save(h, objId);
    };
}


function
prepareLocalChangesF(h: Handle, objId: ObjId) {
    withEditable(h, objId, obj => {
        obj.submittedChanges = obj.localChanges;
        obj.localChanges     = [];
    });
}

function
applyServerResponseF(h: Handle, { objId, res, body }) {
    withEditable(h, objId, obj => {
        if (obj.networkRequest === res.networkRequest) {
            obj.networkRequest = undefined;
        }

        // Clear out any traces that we've submitted changes to the
        // server.
        obj.submittedChanges = [];

        applyPatches(obj, [].concat(body.previousPatches, body.resultingPatches));
        initContent(obj);
    });
}

function
restoreLocalChangesF(h: Handle, objId: ObjId) {
    withEditable(h, objId, obj => {
        obj.localChanges     = obj.submittedChanges.concat(obj.localChanges);
        obj.submittedChanges = [];
    });
}

function
saveEditable(h: Handle, objId: ObjId): void {
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
    modifyHandle(h, mkAction(
        `prepareLocalChanges(${objId})`,
        objId,
        prepareLocalChangesF));


    let url = endpointUrl(h, '/objects/' + objId);
    let req = h.fetch(url, { credentials: 'include', method: 'PATCH', body: data, headers: { accept: 'application/json', 'content-type': 'application/json' }}).then(res => {
        if (res.status === 200) {
            return res.json();
        } else {
            throw new Error('Avers.saveEditable: status ' + res.status);
        }
    });

    runNetworkRequest(h, objId, req).then(res => {
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

        modifyHandle(h, mkAction(
            `applyServerResponse(${objId})`,
            { objId, res, body },
            applyServerResponseF));

        // See if we have any more local changes which we need to save.
        saveEditable(h, objId);

    }).catch(err => {
        // The server would presumably respond with changes which
        // were submitted before us, and we'd have to rebase our
        // changes on top of that.

        modifyHandle(h, mkAction(
            `restoreLocalChanges(${objId})`,
            objId,
            restoreLocalChangesF));
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
            modifyHandle(this.h, mkAction(`updateObjectCollection(${this.collectionName})`, {}, () => {
                this.objectIds = ids;
            }));
        }
    }

    private fetch(): void {
        let now = Date.now();
        if (now - this.fetchedAt > 10 * 1000) {
            this.fetchedAt = now;

            this.h.fetch(this.url, { credentials: 'include', headers: { accept: 'application/json' }}).then(res => {
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
    modifyHandle(c.h, mkAction(`resetObjectCollection(${c.collectionName})`, {}, () => {
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
    let s = lookupStaticE<T>(h, ns, key);
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
        runNetworkRequest(h, s, s.fetch()).then(res => {
            resolveStatic(h, s, res.res);
        });
    }
}

function
resolveStaticF(h: Handle, { s, value }) {
    withStaticE(h, s.ns, s.key, e => {
        e.networkRequest = undefined;
        e.lastError      = undefined;
        e.value          = value;
    });
}

export function
resolveStatic<T>(h: Handle, s: Static<T>, value: T): void {
    modifyHandle(h, mkAction(
        `resolveStatic(${s.ns.toString()}, ${s.key})`,
        { s, value },
        resolveStaticF));
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
        runNetworkRequest(h, e, e.fetch()).then(res => {
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

function
resolveEphemeralF(h: Handle, { e, value, expiresAt }) {
    withEphemeralE(h, e.ns, e.key, e => {
        e.networkRequest = undefined;
        e.lastError      = undefined;
        e.value          = value;
        e.expiresAt      = expiresAt;
    });
}

export function
resolveEphemeral<T>
( h         : Handle
, e         : Ephemeral<T>
, value     : T
, expiresAt : number
): void {
    modifyHandle(h, mkAction(`
        resolveEphemeral(${e.ns.toString()}, ${e.key})`,
        { e, value, expiresAt },
        resolveEphemeralF));
}





// Patch
// -----------------------------------------------------------------------
//
// Patches are read-only on the client.

export class Patch {
    constructor
      ( public objectId   : ObjId
      , public revisionId : RevId
      , public authorId   : ObjId
      , public createdAt  : string
      , public operation  : Operation
      ) {}
}


function
parsePatch(json): Patch {
    return new Patch
        ( json.objectId
        , json.revisionId
        , json.authorId
        , json.createdAt
        , json.operation
        );
}


export function
fetchPatch(h: Handle, objectId: ObjId, revId: RevId): Promise<Patch> {
    let url = endpointUrl(h, '/objects/' + objectId + '/patches/' + revId);
    return h.fetch(url, { credentials: 'include', headers: { accept: 'application/json' }}).then(res => {
        if (res.status === 200) {
            return res.json().then(json => parsePatch(json));
        } else {
            throw new Error('Avers.fetchPatch: status ' + res.status);
        }
    });
}


function
mkPatch(h: Handle, objectId: ObjId, revId: RevId): Static<Patch> {
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
lookupPatch(h: Handle, objectId: ObjId, revId: RevId): Computation<Patch> {
    return staticValue(h, mkPatch(h, objectId, revId));
}
