// A computation describes a way to compute a value out of the environment.
// The value may not immediately be available (eg. if it's being asynchronously
// fetched from a server).

class Computation<T> {

    // Special value which can be used to denote that the computation is
    // pending and the result may become available at a later time.
    static Pending : any = {};


    // The function which when called will produce the computation result.
    private fn : () => T;


    constructor(fn: () => T) {
        this.fn = fn;
    }



    // Convenience functions to create pure and failing computations.
    static pure<V>(value: V) { return new Computation(() => { return value; }); }
    static fail<V>(e: Error) { return new Computation((): V => { throw e; }); }

    // A predefined computation which is always pending. It is a property
    // rather than a function because it doesn't have to be parametrized.
    static pending = new Computation(() => { return <any> Computation.Pending; });


    // Like the ES6 Promise#then function.
    then<V>(resolve: (value: T) => V, reject?: (err: Error) => V): Computation<V> {
        return new Computation(() => {
            try {
                return resolve(this.fn());
            } catch (e) {
                if (reject) {
                    return reject(e);
                } else {
                    throw e;
                }
            }
        });
    }

    // Map over the result. Pending state and errors are passsed onto the next
    // computation untounched.
    fmap<V>(f: (value: T) => V): Computation<V> {
        return this.then(v => {
            if (v === Computation.Pending) {
                return <V> Computation.Pending;
            } else {
                return f(v);
            }
        });
    }

    // Like fmap, but the function can return a computation which is then
    // automatically executed.
    bind<V>(f: (value: T) => Computation<V>): Computation<V> {
        return this.fmap(v => {
            return f(v).fn();
        });
    }


    // Pending computations and errors are passed through.
    static liftA2<A,B,C>(a: Computation<A>, b: Computation<B>, f: (a: A, b: B) => C): Computation<C> {
        try {
            var av = a.fn(), bv = b.fn();

            if (av !== Computation.Pending && bv !== Computation.Pending) {
                return new Computation(() => {
                    return f(av, bv);
                });
            } else {
                return Computation.pending;
            }
        } catch (e) {
            return Computation.fail<C>(e);
        }
    }

    // Get the result of this computation. If the result is not available yet,
    // return the fallback value.
    get(fallback: T): T {
        try {
            var result = this.fn();
            if (result === Computation.Pending) {
                return fallback;
            } else {
                return result;
            }
        } catch (e) {
            return fallback;
        }
    }
}


declare var module: any;
if (typeof module !== 'undefined') {
    module.exports = Computation;
}
