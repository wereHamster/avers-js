var assert = chai.assert;

function Author() {
    Avers.initializeProperties(this);
}

var jsonAuthor = {
    firstName: 'Tomas', lastName: 'Carnecky'
}

Avers.definePrimitive(Author, 'firstName', { value: 'John' });
Avers.definePrimitive(Author, 'lastName',  { value: 'Doe'  });


function Book() {
    Avers.initializeProperties(this);
}

var jsonBook = {
    type: 'book',
    title: 'Game of Thrones',
    author: jsonAuthor
}

var jsonBookWithId = {
    id: 'some-random-id',
    type: 'book',
    title: 'Game of Thrones',
    author: jsonAuthor
}

Avers.typeTag(Book, 'book');
Avers.definePrimitive(Book, 'title');
Avers.defineObject(Book, 'author', {
    value: function() { return Avers.parseJSON(Author, jsonAuthor); },
    parser: Avers.createParser(Author)
});


function Magazine() {
    Avers.initializeProperties(this);
}

var jsonMagazine = {
    type: 'magazine',
    title: 'Vouge'
}

Avers.typeTag(Magazine, 'magazine');
Avers.definePrimitive(Magazine, 'title');


function Library() {
    Avers.initializeProperties(this);
}

Avers.defineCollection(Library, 'books', {
    parser: Avers.createParser(Book)
});


describe('Avers.parseJSON', function() {
    it('should create a new object from json', function() {
        var book = Avers.parseJSON(Book, jsonBook);
        assert.equal('book', book.type);
        assert.equal('Game of Thrones', book.title);
        assert.equal('Tomas', book.author.firstName);
        assert.equal('Carnecky', book.author.lastName);
    })

    it('should accept an empty JSON if the fields have a default', function() {
        var author = Avers.parseJSON(Author, {});
        assert.isUndefined(author.firstName);
        assert.isUndefined(author.lastName);
    })
})

+describe('Avers.updateObject', function() {
    it('Avers.updateObject should update an existing object', function() {
        var book = new Book();
        Avers.updateObject(book, jsonBook);
        assert.equal('book', book.type);
        assert.equal('Game of Thrones', book.title);
        assert.equal('Tomas', book.author.firstName);
        assert.equal('Carnecky', book.author.lastName);
    })
})

describe('Avers.toJSON', function() {
    function runTest(x, json) {
        assert.deepEqual(json, Avers.toJSON(x));
        assert.doesNotThrow(function() {
            JSON.stringify(Avers.toJSON(x));
        });
    }

    it('should handle primitive types', function() {
        [ null, 42, 'string' ].forEach(function(x) { runTest(x, x); });
    })
    it('should handle objects', function() {
        runTest(Avers.parseJSON(Book, jsonBook), jsonBook);
    })
    it('should handle collections', function() {
        var library = new Library();
        Avers.migrateObject(library);
        library.books.push(Avers.parseJSON(Book, jsonBookWithId));
        runTest(library.books, [jsonBookWithId]);
    })
})

describe('Change event propagation', function() {
    // This timeout is very conservative;
    this.timeout(500);

    function expectChangeAtPath(obj, expectedPath, done) {
        obj.on('change', function(path) {
            if (path === expectedPath) { done(); }
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

    it('should deliver changes when adding elments to a collection', function(done) {
        var library = new Library();
        Avers.migrateObject(library);

        expectChangeAtPath(library, 'books', done);
        library.books.push(Avers.parseJSON(Book, jsonBook))
    });

    it('Avers.deliverChangeRecords should flush all changes', function(done) {
        var changeAfter, book = Avers.parseJSON(Book, jsonBook);
        Avers.deliverChangeRecords();

        book.on('change', function() { changeAfter = true; });

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
        var book, library = new Library();
        Avers.migrateObject(library);

        library.books.push(book = Avers.parseJSON(Book, jsonBook));
        Avers.deliverChangeRecords();

        var id   = Avers.itemId(library.books, book);
        var path = 'books.' + id + '.author.firstName';

        assert.equal('Tomas', Avers.resolvePath(library, path));
    });
    it('should return undefined if the path can not be resolved', function() {
        assert.isUndefined(Avers.resolvePath({}, 'array.0.deep.key'));
    });
    it('should ignore properties that are not registered', function() {
        var book = Avers.parseJSON(Book, jsonBook);
        book.author.something = '42';
        assert.isUndefined(Avers.resolvePath(book, 'author.something'));
    });
    it('should ignore array indices out of bounds', function() {
        var library = new Library();
        assert.isUndefined(Avers.resolvePath(library.books, '1'));
    });
    it('should ignore properties on arrays', function() {
        var library = new Library();
        Avers.migrateObject(library);

        library.books.something = '42';
        assert.isUndefined(Avers.resolvePath(library.books, 'something'));
    });
});

describe('Avers.itemId', function() {
    it('should return undefined until changes have been delivered', function() {
        var book, library = new Library();
        Avers.migrateObject(library);

        library.books.push(book = Avers.parseJSON(Book, jsonBook));
        assert.isUndefined(Avers.itemId(library.books, book));
    });
    it('should return a local id for new items', function() {
        var book, library = new Library();
        Avers.migrateObject(library);

        library.books.push(book = Avers.parseJSON(Book, jsonBook));
        Avers.deliverChangeRecords();
        assert.match(Avers.itemId(library.books, book), /~.*/);
    });
    it('should return the item id when the item has one set', function() {
        var book, library = new Library();
        Avers.migrateObject(library);

        library.books.push(book = Avers.parseJSON(Book, jsonBookWithId));
        Avers.deliverChangeRecords();
        assert.equal(Avers.itemId(library.books, book), jsonBookWithId.id);
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
        var book, library = new Library();
        Avers.migrateObject(library);

        library.books.push(book = Avers.parseJSON(Book, jsonBook));
        var clone = Avers.clone(library.books);
        assert.deepEqual(Avers.toJSON(library.books), Avers.toJSON(clone));
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
    it('should initialize collections to an empty array', function() {
        var library = Avers.parseJSON(Library, {});
        Avers.migrateObject(library);
        assert.isArray(library.books);
    });
});

describe('Avers.mk', function() {
    it('should create and migrate the object', function() {
        var author = Avers.mk(Author, {});
        assert.equal('John', author.firstName);
    });
});
