function Author() {
    Avers.initializeProperties(this);
}

Avers.definePrimitive(Author, 'firstName');
Avers.definePrimitive(Author, 'lastName');


function Book() {
    Avers.initializeProperties(this);
}

Avers.definePrimitive(Book, 'title');
Avers.defineObject(Book, 'author', {
    parser: Avers.createParser(Author)
});

function mkBook(title) {
    var book = new Book();

    book.title  = 'A Tale of Two Cities';
    book.author = new Author();

    return book;
}

function Library() {
    Avers.initializeProperties(this);
}

Avers.definePrimitive(Library, 'location');
Avers.defineCollection(Library, 'books', {
    parser: Avers.createParser(Book)
});

library = new Library();

var changes = document.querySelector('#changes');
library.on('change', function(path, op) {
    var li = document.createElement('li');
    li.innerText = path + ' changed to ' + JSON.stringify(Avers.toJSON(op.value));
    changes.appendChild(li);
});

Avers.updateObject(library, {
    location: 'Europe', books: []
});

book = Avers.parseJSON(Book, {
    title: 'The Little Prince',
    author: { firstName: 'Antoine', lastName: 'Saint-Exupéry' }
});

library.books.push(book);
