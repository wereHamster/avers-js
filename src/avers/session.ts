import { Handle, startNextGeneration, endpointUrl } from './storage';
import { assign } from './shared';


export enum Transition {
    Restore, Signin, Signup, Signout
};



export class Session {

    constructor(public h: Handle) {}

    objId      : string     = undefined;
    transition : Transition = undefined;
    lastError  : Error      = undefined;
}


function runReq(session: Session, path: string, opts = {}): Promise<Response> {
    let url = endpointUrl(session.h, path);
    return session.h.fetch(url, assign({ credentials: 'include' }, opts));
}

function jsonOk(res: Response): Promise<any> {
    if (res.status >= 200 && res.status < 300) {
        return res.json();
    } else {
        throw new Error('Status ' + res.status);
    }
}



function beginTransition(session: Session, t: Transition) {
    session.transition = t;
    session.lastError  = undefined;

    startNextGeneration(session.h);
}

function finishTransition(session: Session, objId: string, err: Error) {
    session.objId      = objId;
    session.transition = undefined;
    session.lastError  = err;

    startNextGeneration(session.h);
}



// restoreSession
// -----------------------------------------------------------------------
//
// Attempt to determine the session status by contacting the server. The
// server returns either 404 if no session exists, or 200 and includes
// the session ObjId in the response.

export function
restoreSession(session: Session): Promise<void> {
    beginTransition(session, Transition.Restore);
    return runReq(session, '/session').then(res => {

        // We allow both 200 and 404 to be valid responses and don't set the
        // last error in these cases.

        if (res.status === 200) {
            return res.json().then(json => {
                finishTransition(session, json.objId, undefined);
            });
        } else if (res.status === 404) {
            finishTransition(session, undefined, undefined);
        } else {
            throw new Error('Status ' + res.status);
        }

    }).catch(err => {
        finishTransition(session, undefined, err);
        throw err;
    });
}


// signup
// -----------------------------------------------------------------------
//
// Create a new object on the server against which one can sign in. This
// will usually be an account, if the server has such a concept.
//
// Note that this doesn't automatically authenticate the client. If you want
// to continue with the just created account, you need to sign in with it.
//
// Also, creating a new account will not invalidate an existing session.

export function
signup(session: Session, login: string): Promise<string> {
    let body = JSON.stringify({ login: login });

    beginTransition(session, Transition.Signup);
    return runReq(session, '/signup', { method: 'POST', body: body, headers: { accept: 'application/json', 'content-type': 'application/json' } }).then(jsonOk).then(json => {

        // Signup doesn't authenticate the client. Therefore we preserve
        // the existing objId in the session.
        finishTransition(session, session.objId, undefined);

        return json.objId;
    }).catch(err => {
        finishTransition(session, session.objId, err);
        throw err;
    });
}


// signin
// -----------------------------------------------------------------------
//
// Sign in with an identifier of an object against which one can
// authenticate.

export function
signin(session: Session, login: string, secret: string): Promise<void> {
    let body = JSON.stringify({ login: login, secret: secret });

    beginTransition(session, Transition.Signin);
    return runReq(session, '/session', { method: 'POST', body: body, headers: { accept: 'application/json', 'content-type': 'application/json' } }).then(jsonOk).then(json => {
        finishTransition(session, json.objId, undefined);
    }).catch(err => {
        finishTransition(session, undefined, err);
        throw err;
    });
}


// signout
// -----------------------------------------------------------------------
//
// Delete the session and revert the session to the Anynomous state.

export function
signout(session: Session): Promise<void> {
    beginTransition(session, Transition.Signout);
    return runReq(session, '/session', { method: 'DELETE' }).then(res => {
        if (res.status === 200 || res.status === 204) {
            finishTransition(session, undefined, undefined);
        } else {
            throw new Error('Status ' + res.status);
        }
    }).catch(err => {
        finishTransition(session, session.objId, err);
        throw err;
    });
}
