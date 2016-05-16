import * as Avers from '../src/avers';
import {assert} from "chai";


class Sentinel {}
const sentinel: any = new Sentinel;

const testNamespace = Symbol('testNamespace');


class Author {
    firstName : string;
    lastName  : string;
}

var jsonAuthor = {
    firstName: 'Tomas', lastName: 'Carnecky'
};

Avers.definePrimitive(Author, 'firstName', 'John');
Avers.definePrimitive(Author, 'lastName',  'Doe');

var unknownAuthor = Avers.mk(Author, {
    firstName: 'John',
    lastName: 'Doe'
});


class Book {
    title  : string;
    author : Author;
    tags   : string[];
}

var jsonBook = {
    title: 'Game of Thrones',
    author: jsonAuthor,
    tags: ['violent', 'fantasy']
};

var jsonBookWithId = {
    id: 'some-random-id',
    title: 'Game of Thrones',
    author: jsonAuthor,
    tags: ['violent', 'fantasy']
};

Avers.definePrimitive(Book, 'title');
Avers.defineObject(Book, 'author', Author, unknownAuthor);
Avers.defineCollection(Book, 'tags', String);


class Magazine {
    title     : string;
    publisher : string;
}

/*
var jsonMagazine = {
    title: 'Vouge',
    publisher: 'Condé Nast'
};
*/

Avers.definePrimitive(Magazine, 'title');
Avers.definePrimitive(Magazine, 'publisher');


class Diary {}
Avers.declareConstant(Diary);


class Item {
    id      : string;
    content : Book | Magazine | Diary;
}

var jsonItem = {
    type: 'book',
    content: jsonBook
};

var jsonBookItemWithId = {
    id: 'some-random-id',
    type : 'book',
    content : jsonBook
};


var def = Avers.mk(Book, jsonBook);
Avers.defineVariant(Item, 'content', 'type', { book: Book, magazine: Magazine, diary: Diary }, def);


class NullableTest {
    obj     : Diary;
    variant : Book | Magazine;
};

Avers.defineObject(NullableTest, 'obj', Diary);
Avers.defineVariant(NullableTest, 'variant', 'type', { book: Book, magazine: Magazine });


class Library {
    items : Avers.Collection<Item>;
};

Avers.defineCollection(Library, 'items', Item);


function now(): number {
    return Date.now();
}

function mkHandle(json: any): Avers.Handle {
    function fetch(url: string) {
        return Promise.resolve(
            { status : 200
            , json   : () => { return Promise.resolve(json); }
            }
        );
    }

    function createWebSocket(path: string) {
        return <any> {
            addEventListener() {},
        };
    }

    let infoTable = new Map<string, Avers.ObjectConstructor<any>>();
    infoTable.set('library', Library);
    infoTable.set('book', Book);

    return new Avers.Handle('/api', fetch, createWebSocket, now, infoTable);
}

function mkObjectCollection() {
    var h = mkHandle(['one', 'two']);
    return new Avers.ObjectCollection(h, '/test');
}

const libraryObjectResponse =
    { type      : 'library'
    , id        : 'id'
    , createdAt : new Date().toISOString()
    , createdBy : 'me'
    , content   : {}
    };

const bookObjectResponse =
    { type      : 'book'
    , id        : 'id'
    , createdAt : new Date().toISOString()
    , createdBy : 'me'
    , content   : jsonBook
    };


function unresolvedPromiseF() {
    return new Promise(function() { /* empty */ });
}


describe('Avers.parseJSON', function() {
    it('should create a new object from json', function() {
        var book = Avers.parseJSON(Book, jsonBook);
        assert.equal('Game of Thrones', book.title);
        assert.equal('Tomas', book.author.firstName);
        assert.equal('Carnecky', book.author.lastName);
    });

    it('should accept an empty JSON if the fields have a default', function() {
        var author = Avers.parseJSON(Author, {});
        assert.isUndefined(author.firstName);
        assert.isUndefined(author.lastName);
    });

    it('should instanciate plain classes in variant properties', function() {
        var item = Avers.parseJSON(Item, { type: 'diary', content: {} });
        assert.instanceOf(item.content, Diary, 'Item content is not a Diary');
    });
});

describe('Avers.updateObject', function() {
    it('Avers.updateObject should update an existing object', function() {
        var book = new Book();
        Avers.updateObject(book, jsonBook);
        assert.equal('Game of Thrones', book.title);
        assert.equal('Tomas', book.author.firstName);
        assert.equal('Carnecky', book.author.lastName);
    });
});

describe('Avers.toJSON', function() {
    function runTest(x: any, json: any): void {
        assert.deepEqual(Avers.toJSON(x), json);
        assert.doesNotThrow(function() {
            JSON.stringify(Avers.toJSON(x));
        });
    }

    it('should handle primitive types', function() {
        [ null, 42, 'string' ].forEach(x => {
            runTest(x, x);
        });
    });
    it('should handle objects', function() {
        runTest(Avers.parseJSON(Book, jsonBook), jsonBook);
    });
    it('should handle variants', function() {
        var json = { type: 'book', content: jsonBook };
        runTest(Avers.parseJSON(Item, json), json);
    });
    it('should handle variant properties with plain constructors', function() {
        var json = { type: 'diary', content: {} };
        runTest(Avers.parseJSON(Item, json), json);
    });
    it('should handle collections', function() {
        var library = Avers.mk(Library, {});
        library.items.push(Avers.parseJSON(Item, jsonBookItemWithId));
        runTest(library.items, [jsonBookItemWithId]);
    });
});

describe('Change event propagation', function() {
    // This timeout is very conservative;
    this.timeout(500);

    function expectChangeAtPath<T>(obj: T, expectedPath: string, done: () => void) {
        Avers.attachChangeListener(obj, function changeCallback(changes) {
            changes.forEach(function(change) {
                if (change.path === expectedPath) {
                    Avers.detachChangeListener(obj, changeCallback);
                    done();
                    done = function() {
                        // Intentionally left blank to avoid calling the done
                        // callback more than once.
                    };
                }
            });
        });
    }

    it('should deliver changes of primitive values on the root object', function(done) {
        var book = Avers.parseJSON(Book, jsonBook);

        expectChangeAtPath(book, 'title', done);
        book.title = 'GAME OF THRONES';
    });

    it('should deliver changes of embedded objects', function(done) {
        var book = Avers.parseJSON(Book, jsonBook);

        expectChangeAtPath(book, 'author.firstName', done);
        book.author.firstName = 'TOMAS';
    });

    it('should deliver changes inside variant properties', function(done) {
        var item = Avers.mk(Item, jsonItem);

        expectChangeAtPath(item, 'content.author.firstName', done);
        (<Book>item.content).author.firstName = 'TOMAS';
    });

    it('should deliver changes when adding elments to a collection', function(done) {
        var library = Avers.mk(Library, {});

        expectChangeAtPath(library, 'items', done);
        library.items.push(Avers.parseJSON(Item, jsonItem));
    });
});

describe('Avers.resolvePath', function() {
    it('should resolve in a simple object', function() {
        var book = Avers.parseJSON(Book, jsonBook);
        assert.equal('Game of Thrones', Avers.resolvePath(book, 'title'));
    });
    it('should resolve an empty string to the object itself', function() {
        var book = Avers.parseJSON(Book, jsonBook);
        assert.equal('Game of Thrones', Avers.resolvePath(book.title, ''));
    });
    it('should resolve nested objects', function() {
        var book = Avers.parseJSON(Book, jsonBook);
        assert.equal('Tomas', Avers.resolvePath(book, 'author.firstName'));
    });
    it('should resolve across arrays', function() {
        var item = Avers.parseJSON(Item, jsonBookItemWithId)
          , library = Avers.mk(Library, {});

        library.items.push(item);

        var id   = Avers.itemId(library.items, item);
        var path = 'items.' + id + '.content.author.firstName';

        assert.equal('Tomas', Avers.resolvePath(library, path));
    });
    it('should return undefined if the path can not be resolved', function() {
        assert.isUndefined(Avers.resolvePath({}, 'array.0.deep.key'));
    });
    it('should ignore properties that are not registered', function() {
        var book = Avers.parseJSON(Book, jsonBook);
        (<any>book.author).something = '42';
        assert.isUndefined(Avers.resolvePath(book, 'author.something'));
    });
    it('should ignore array indices out of bounds', function() {
        var library = new Library();
        assert.isUndefined(Avers.resolvePath(library.items, '1'));
    });
    it('should ignore properties on arrays', function() {
        var library = Avers.mk(Library, {});

        (<any>library.items).something = '42';
        assert.isUndefined(Avers.resolvePath(library.items, 'something'));
    });
});

describe('Avers.applyOperation', function() {

    function run(op: Avers.Operation, f: (a: Book, b: Book) => void): void {
        let orig = Avers.mk(Book, jsonBook)
          , copy = Avers.applyOperation(orig, op.path, op);

        f(orig, copy);
    }

    describe('set', function() {
        function mkOp(path: string, value: any): Avers.Operation {
            return { type: 'set', path, value };
        }

        it('should return a copy of the object if some property was changed', function() {
            run(mkOp('title', 'A Song of Ice and Fire'), (orig, copy) => {
                assert.notEqual(orig, copy);
            });
        });
        it.skip('should return a the same object if no changes were needed', function() {
            run(mkOp('title', jsonBook.title), (orig, copy) => {
                assert.equal(orig, copy);
            });
        });
    });
    describe('splice', function() {
        function mkOp(path: string, index: number, remove: number, insert: any[]): Avers.Operation {
            return { type: 'splice', path, index, remove, insert };
        }

        it('should return a copy of the object if some property was changed', function() {
            let lib  = Avers.mk(Library, {});
            let copy = Avers.applyOperation(lib, 'items', mkOp('items', 0, 0, [jsonBookItemWithId]));

            assert.notEqual(lib, copy);
        });
        it.skip('should return a the same object if no changes were needed', function() {
            let lib  = Avers.mk(Library, {});
            let copy = Avers.applyOperation(lib, 'items', mkOp('items', 0, 0, []));

            assert.equal(lib, copy);
        });
    });
});

describe('Avers.itemId', function() {
    it('should return undefined until changes have been delivered', function() {
        var item = Avers.parseJSON(Item, jsonItem)
          , library = Avers.mk(Library, {});

        library.items.push(item);
        assert.isUndefined(Avers.itemId(library.items, item));
    });
    it('should return the item id when the item has one set', function() {
        var item = Avers.parseJSON(Item, jsonBookItemWithId)
          , library = Avers.mk(Library, {});

        library.items.push(item);
        assert.equal(Avers.itemId(library.items, item), jsonBookItemWithId.id);
    });
});

describe('Avers.clone', function() {
    it('should clone primitive values', function() {
        assert.equal('str', Avers.clone('str'));
    });
    it('should clone Avers objects', function() {
        var book  = Avers.parseJSON(Book, jsonBook);
        var clone = Avers.clone(book);

        assert.notEqual(book, clone);
        assert.deepEqual(Avers.toJSON(book), Avers.toJSON(clone));
    });
    it('should clone collections', function() {
        var item = Avers.parseJSON(Item, jsonItem)
          , library = Avers.mk(Library, {});

        library.items.push(item);
        var clone = Avers.clone(library.items);
        assert.deepEqual(Avers.toJSON(library.items), Avers.toJSON(clone));
    });
});

describe('Avers.migrateObject', function() {
    it('should set primitive properties to their default value', function() {
        var author = Avers.parseJSON(Author, {});
        Avers.migrateObject(author);
        assert.equal('John', author.firstName);
    });
    it('should initialize objects with their default value', function() {
        var book = Avers.parseJSON(Book, {});
        Avers.migrateObject(book);
        assert.instanceOf(book.author, Author);
    });
    it('should not initialize object properties without a default value', function() {
        var nt = Avers.parseJSON(NullableTest, {});
        Avers.migrateObject(nt);
        assert(!nt.obj);
    });
    it('should not initialize variant properties without a default value', function() {
        var nt = Avers.parseJSON(NullableTest, {});
        Avers.migrateObject(nt);
        assert(!nt.variant);
    });
    it('should initialize variant properties with a default value', function() {
        var item = Avers.parseJSON(Item, {});
        Avers.migrateObject(item);
        assert.instanceOf(item.content, Book);
    });
    it('should initialize collections to an empty array', function() {
        var library = Avers.parseJSON(Library, {});
        Avers.migrateObject(library);
        assert.isArray(library.items);
    });
});

describe('Avers.mk', function() {
    it('should create and migrate the object', function() {
        var author = Avers.mk(Author, {});
        assert.equal('John', author.firstName);
    });

    it('should flush all changes', function() {
        var author = Avers.mk(Author, jsonAuthor)
          , allChanges: Avers.Change<any>[] = [];

        Avers.attachChangeListener(author, changes => {
            allChanges = allChanges.concat(changes);
        });

        author.firstName = 'Jane';
        assert.lengthOf(allChanges, 1);
    });
});


describe('Avers.lookupItem', function() {
    it('should find the item in the collection', function() {
        var library = Avers.mk(Library, {});
        library.items.push(Avers.mk(Item, jsonBookItemWithId));
        console.log('library', library.items);
        assert(!!Avers.lookupItem(library.items, jsonBookWithId.id));
    });
    it('should find non-existing in the collection', function() {
        var library = Avers.mk(Library, {});
        library.items.push(Avers.mk(Item, jsonBookItemWithId));
        assert.isUndefined(Avers.lookupItem(library.items, 'non-existing-id'));
    });
});

describe('Avers.attachGenerationListener', function() {
    it('should invoke the listener when the data cahnges', function(done) {
        let h = mkHandle({});
        Avers.attachGenerationListener(h, () => { done(); });
        Avers.startNextGeneration(h);
    });
});



describe('Avers.lookupEditable', function() {
    it('should return a Computation in Pending status', function() {
        assert.equal(sentinel, Avers.lookupEditable(mkHandle(libraryObjectResponse), 'id').get(sentinel));
    });
    it('should resolve to the object after it is loaded', function(done) {
        let h = mkHandle(libraryObjectResponse);

        Avers.lookupEditable(h, 'id').get(sentinel);
        setTimeout(() => {
            var obj = Avers.lookupEditable(h, 'id').get(sentinel);
            assert.instanceOf(obj, Avers.Editable);
            assert.instanceOf(obj.content, Library);
            done();
        }, 0);
    });
    it('should return a copy when its content changes', function() {
        let h = mkHandle({});

        let obj = Avers.mkEditable(h, 'id');
        assert.isUndefined(obj.content);

        Avers.resolveEditable(h, 'id', libraryObjectResponse);
        let copy = Avers.mkEditable(h, 'id');

        assert.instanceOf(copy, Avers.Editable);
        assert.instanceOf(copy.content, Library);

        assert.notEqual(obj, copy);
    });
});

describe('registering changes on an Editable', function() {
    it('should make a copy of the content', function() {
        let h = mkHandle({});

        Avers.resolveEditable(h, 'id', libraryObjectResponse);
        let obj = Avers.mkEditable<Library>(h, 'id');

        assert.instanceOf(obj.content, Library);
        obj.content.items.push(Avers.mk(Item, jsonBookItemWithId));

        let copy = Avers.mkEditable<Library>(h, 'id');
        assert.instanceOf(copy.content, Library);
        assert.notEqual(obj.content, copy.content);
    });
    it.skip('should preserve objects not in the change path', function() {
        let h = mkHandle({});
        Avers.resolveEditable(h, 'id', bookObjectResponse);

        let obj = Avers.mkEditable<Book>(h, 'id');
        obj.content.title = 'A Song of Ice and Fire';

        let copy = Avers.mkEditable<Book>(h, 'id');
        assert.notEqual(obj.content, copy.content, 'content');
        assert.equal(obj.content.author, copy.content.author, 'content.author');
    });
});

describe('Avers.ObjectCollection', function() {
    describe('ids', function() {
        it('should return a pending Computation when not fetched yet', function() {
            var col = mkObjectCollection();
            assert.equal(sentinel, col.ids.get(sentinel));
        });
        it('should resolve to the object after it is loaded', function(done) {
            var col = mkObjectCollection();
            col.ids.get(sentinel);

            setTimeout(() => {
                var ids = col.ids.get(sentinel);
                assert.isArray(ids);
                assert.lengthOf(ids, 2);
                done();
            }, 0);
        });
    });
});

describe('Avers.ephemeralValue', function() {
    let e = new Avers.Ephemeral(testNamespace, 'test', unresolvedPromiseF);

    it('should return pending when the object is empty', function() {
        let h = mkHandle({});
        assert.equal(sentinel, Avers.ephemeralValue(h, e).get(sentinel));
    });
    it('should return the value when the object is resolved', function() {
        let h = mkHandle({});
        Avers.resolveEphemeral(h, e, 42, h.now() + 99);
        assert.equal(42, Avers.ephemeralValue(h, e).get(sentinel));
    });
    it('should return the value even if it is stale', function() {
        let h = mkHandle({});
        Avers.resolveEphemeral(h, e, 42, h.now() - 99);
        assert.equal(42, Avers.ephemeralValue(h, e).get(sentinel));
    });
    it('should invoke the fetch function when the value is stale', function(done) {
        let h = mkHandle({})
          , ne = new Avers.Ephemeral(testNamespace, 'test', done);

        Avers.resolveEphemeral(h, ne, 42, h.now() - 99);
        Avers.ephemeralValue(h, ne).get(sentinel);
    });
    it('should not invoke the fetch function when the value is fresh', function(done) {
        let h = mkHandle({})
          , ne = new Avers.Ephemeral(testNamespace, 'test', () => {
              assert(false, 'fetch of a fresh Ephemeral was invoked');
              return undefined;
          });

        Avers.resolveEphemeral(h, ne, 42, h.now() + 99);
        Avers.ephemeralValue(h, ne).get(sentinel);

        done();
    });
});

describe('Avers.staticValue', function() {
    let s = new Avers.Static(testNamespace, 'test', unresolvedPromiseF);

    it('should return pending when the object is empty', function() {
        let h = mkHandle({});
        assert.equal(sentinel, Avers.staticValue(h, s).get(sentinel));
    });
    it('should return the value when the object is resolved', function() {
        let h = mkHandle({});
        Avers.resolveStatic(h, s, 42);
        assert.equal(42, Avers.staticValue(h, s).get(sentinel));
    });
});
