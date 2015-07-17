import { Handle, startNextGeneration, endpointUrl } from './storage';


export enum SessionStatus

    { Unknown
      // ^ The initial state of the session. The only possible action in
      // this state is 'restoreSession'.
      //
      //  -> Authenticated | Anonymous | Error

    , Authenticated
      // ^ The client is authenticated against a particular ObjId.
      //
      //  -> Anonymous | Error

    , Anonymous
      // ^ The client is not authenticated. As such it can interact with
      // a few selected API endpoints.
      //
      //  -> Authenticated | Error

    , Error
      // ^ A network request failed with an unexpected reason. For most
      // cases this can be treated the same as 'Anonymous'. But some parts
      // of the UI may chose to treat it differently.
      //
      //  -> Authenticated | Anonymous | Error

    }



export class Session {

    constructor(public h: Handle) {}

    status : SessionStatus = SessionStatus.Unknown;
    objId  : string        = undefined;

}


// restoreSession
// -----------------------------------------------------------------------
//
// Attempt to determine the session status by contacting the server. The
// server returns either 404 if no session exists, or 200 and includes
// the session ObjId in the response.

export function
restoreSession(session: Session): Promise<void> {
    let url = endpointUrl(session.h, '/session');
    return session.h.fetch(url, { credentials: 'include' }).then(res => {
        if (res.status === 200) {
            return res.json().then(json => {
                session.status = SessionStatus.Authenticated;
                session.objId  = json.objId;
            });

        } else {
            session.status = SessionStatus.Anonymous;
        }
    }).catch(err => {
        session.status = SessionStatus.Error;
    }).then(() => {
        startNextGeneration(session.h);
    });
}


// signup
// -----------------------------------------------------------------------
//
// Create a new object on the server against which one can sign in. This
// will usually be an account, if the server has such a concept.

export function
signup(session: Session, login: string): Promise<string> {
    let url  = endpointUrl(session.h, '/signup')
      , body = JSON.stringify({ login: login });

    return session.h.fetch(url, { credentials: 'include', method: 'POST', body: body }).then(res => {
        if (res.status === 200) {
            return res.json().then(json => {
                return json.objId;
            });

        } else {
            session.status = SessionStatus.Error;
        }
    }).catch(err => {
        session.status = SessionStatus.Error;
    }).then(objId => {
        startNextGeneration(session.h);
        return objId;
    });
}


// signin
// -----------------------------------------------------------------------
//
// Sign in with an identifier of an object against which one can
// authenticate.

export function
signin(session: Session, login: string, secret: string): Promise<void> {
    let url  = endpointUrl(session.h, '/session')
      , body = JSON.stringify({ login: login, secret: secret });

    return session.h.fetch(url, { credentials: 'include', method: 'POST', body: body }).then(res => {
        if (res.status === 200) {
            return res.json().then(json => {
                session.status = SessionStatus.Authenticated;
                session.objId  = json.objId;
            });

        } else {
            session.status = SessionStatus.Error;
        }
    }).catch(err => {
        session.status = SessionStatus.Error;
    }).then(() => {
        startNextGeneration(session.h);
    });
}


// signout
// -----------------------------------------------------------------------
//
// Delete the session and revert the session to the Anynomous state.

export function
signout(session: Session): Promise<void> {
    let url = endpointUrl(session.h, '/session');
    return session.h.fetch(url, { credentials: 'include', method: 'DELETE' }).then(res => {
        if (res.status === 200) {
            session.status = SessionStatus.Anonymous;
            session.objId  = undefined;
        } else {
            session.status = SessionStatus.Error;
        }
    }).catch(err => {
        session.status = SessionStatus.Error;
    }).then(() => {
        startNextGeneration(session.h);
    });
}
