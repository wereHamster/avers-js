var assert = chai.assert;

function Author() {
    Avers.initializeProperties(this);
}

var jsonAuthor = {
    firstName: 'Tomas', lastName: 'Carnecky'
}

Avers.definePrimitive(Author, 'firstName');
Avers.definePrimitive(Author, 'lastName');


function Book() {
    Avers.initializeProperties(this);
}

var jsonBook = {
    type: 'book',
    title: 'Game of Thrones',
    author: jsonAuthor
}

Avers.typeTag(Book, 'book');
Avers.definePrimitive(Book, 'title');
Avers.defineObject(Book, 'author', {
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


describe('JSON parser', function() {
    it('Avers.parseJSON should create a new object from json', function() {
        var book = Avers.parseJSON(Book, jsonBook);
        assert.equal('book', book.type);
        assert.equal('Game of Thrones', book.title);
        assert.equal('Tomas', book.author.firstName);
        assert.equal('Carnecky', book.author.lastName);
    })

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
        library.books.push(Avers.parseJSON(Book, jsonBook));
        runTest(library.books, [jsonBook]);
    })
})

describe('Change events', function() {
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

        expectChangeAtPath(library, 'books', done);
        library.books.push(Avers.parseJSON(Book, jsonBook))
    });
});
