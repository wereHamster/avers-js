/// <reference path="./ext/mocha.d.ts" />
/// <reference path="./ext/computation.ts" />

/// <reference path="./avers.ts" />
/// <reference path="./avers.storage.ts" />
/// <reference path="./avers.session.ts" />


declare var chai, require, process;
var assert;
try {
    assert = require('./node_modules/chai/chai.js').assert;
} catch (e) {
    assert = chai.assert;
}

const sentinel: any = {};


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
    tags   : string;
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

var jsonMagazine = {
    title: 'Vouge',
    publisher: 'Condé Nast'
};

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

function mkHandle(json) {
    function fetch(url: string) {
        return Promise.resolve(
            { status : 200
            , json   : () => { return Promise.resolve(json); }
            }
        );
    }

    let infoTable = new Map<string, Avers.ObjectConstructor<any>>();
    infoTable.set('library', Library);

    return new Avers.Handle('/api', fetch, now, infoTable);
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
    function runTest(x, json) {
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

    function expectChangeAtPath(obj, expectedPath, done) {
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

    it('Avers.deliverChangeRecords should flush all changes', function(done) {
        var changeAfter, book = Avers.parseJSON(Book, jsonBook);
        Avers.deliverChangeRecords(book);

        Avers.attachChangeListener(book, function(changes) { changeAfter = true; });

        setTimeout(function() {
            assert.notOk(changeAfter, 'Callback invoked after flushing changes');
            done();
        }, 10);
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
        var item, library = Avers.mk(Library, {});

        library.items.push(item = Avers.parseJSON(Item, jsonBookItemWithId));
        Avers.deliverChangeRecords(library);

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

describe('Avers.itemId', function() {
    it('should return undefined until changes have been delivered', function() {
        var item, library = Avers.mk(Library, {});

        library.items.push(item = Avers.parseJSON(Item, jsonItem));
        assert.isUndefined(Avers.itemId(library.items, item));
    });
    it('should return a local id for new items', function() {
        var item, library = Avers.mk(Library, {});

        library.items.push(item = Avers.parseJSON(Item, jsonItem));
        Avers.deliverChangeRecords(library);
        assert.match(Avers.itemId(library.items, item), /~.*/);
    });
    it('should return the item id when the item has one set', function() {
        var item, library = Avers.mk(Library, {});

        library.items.push(item = Avers.parseJSON(Item, jsonBookItemWithId));
        Avers.deliverChangeRecords(library);
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
        var item, library = Avers.mk(Library, {});

        library.items.push(item = Avers.parseJSON(Item, jsonItem));
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

    it('should flush all changes', function(done) {
        var author     = Avers.mk(Author, jsonAuthor)
          , allChanges = [];

        Avers.attachChangeListener(author, changes => {
            allChanges = allChanges.concat(changes);
        });

        author.firstName = 'Jane';
        Avers.deliverChangeRecords(author);

        setTimeout(() => {
            assert.lengthOf(allChanges, 1);
            done();
        }, 10);
    });
});


describe('Avers.lookupItem', function() {
    it('should find the item in the collection', function() {
        var library = Avers.mk(Library, {});
        library.items.push(Avers.mk(Item, jsonBookItemWithId));
        Avers.deliverChangeRecords(library);
        assert(!!Avers.lookupItem(library.items, jsonBookWithId.id));
    });
    it('should find the item in the collection', function() {
        var library = Avers.mk(Library, {});
        library.items.push(Avers.mk(Item, jsonBookItemWithId));
        Avers.deliverChangeRecords(library);
        assert.isUndefined(Avers.lookupItem(library.items, 'non-existing-id'));
    });
});


describe('Avers.lookupEditable', function() {
    it('should return a Computation in Pending status', function() {
        assert.equal(sentinel, Avers.lookupEditable(mkHandle({}), 'id').get(sentinel));
    });
    it('should resolve to the object after it is loaded', function(done) {
        let h = mkHandle(libraryObjectResponse);

        Avers.lookupEditable(h, 'id').get(sentinel);
        setTimeout(() => {
            var obj = Avers.lookupEditable(h, 'id').get(sentinel);
            assert.instanceOf(obj, Avers.Editable);
            assert.instanceOf(obj.content, Library);
            done();
        }, 10);
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
            }, 10);
        });
    });
});
