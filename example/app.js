function Author() {}
Avers.definePrimitive(Author, 'firstName');
Avers.definePrimitive(Author, 'lastName');


function Book() {}
Avers.definePrimitive(Book, 'title');
Avers.defineObject(Book, 'author', Author);

function Library() {}
Avers.definePrimitive(Library, 'location');
Avers.defineCollection(Library, 'books', Book);

library = Avers.mk(Library, {});

var changes = document.querySelector('#changes');
Avers.attachChangeListener(library, function(path, op) {
    var li = document.createElement('li');
    li.innerText = path + ' changed ' + JSON.stringify(op);
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
