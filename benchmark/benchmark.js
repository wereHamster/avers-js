function Author() {
    Avers.initializeProperties(this);
}

var jsonAuthor = {
    firstName: 'Tomas', lastName: 'Carnecky'
}

Avers.definePrimitive(Author, 'firstName', 'John');
Avers.definePrimitive(Author, 'lastName',  'Doe');

var unknownAuthor = Avers.mk(Author, {
    firstName: 'John',
    lastName: 'Doe',
});


function Book() {
    Avers.initializeProperties(this);
}

var jsonBook = {
    title: 'Game of Thrones',
    author: jsonAuthor,
    tags: ['violent', 'fantasy']
}

var jsonBookWithId = {
    id: 'some-random-id',
    title: 'Game of Thrones',
    author: jsonAuthor,
    tags: ['violent', 'fantasy']
}

Avers.definePrimitive(Book, 'title');
Avers.defineObject(Book, 'author', Author, unknownAuthor);
Avers.defineCollection(Book, 'tags', String);


function Magazine() {
    Avers.initializeProperties(this);
}

var jsonMagazine = {
    title: 'Vouge',
    publisher: 'Condé Nast'
}

Avers.definePrimitive(Magazine, 'title');
Avers.definePrimitive(Magazine, 'publisher');


function Item() {
    Avers.initializeProperties(this);
}

var jsonItem = {
    type: 'book',
    content: jsonBook
}

var def = Avers.mk(Book, jsonBook);
Avers.defineVariant(Item, 'content', 'type', { book: Book, magazine: Magazine }, def);


function NullableTest() {
    Avers.initializeProperties(this);
}

Avers.defineObject(NullableTest, 'obj');
Avers.defineVariant(NullableTest, 'variant', 'type', { book: Book, magazine: Magazine });


function Library() {
    Avers.initializeProperties(this);
}

Avers.defineCollection(Library, 'items', Item);


var book = Avers.mk(Book, jsonBook);
book.on('change', function(){});


var suite = new Benchmark.Suite;
suite.add('Avers.trigger', function() {
    book.trigger('change');
})
.on('cycle', function(event) {
    var result = document.createElement('div');
    result.innerHTML = event.target.toString();
    document.querySelector('.results').appendChild(result);
})
.on('complete', function() {
    //console.log('Fastest is ' + this.filter('fastest').pluck('name'));
})
.run({ 'async': false });

// Avers.trigger x 762,859 ops/sec ±3.04% (83 runs sampled)
//
var suite = new Benchmark.Suite;
suite.add('Avers.off', function() {
    book.listenTo(book, 'change', function(){});
    book.stopListening(book);
})
.on('cycle', function(event) {
    var result = document.createElement('div');
    result.innerHTML = event.target.toString();
    document.querySelector('.results').appendChild(result);
})
.on('complete', function() {
    //console.log('Fastest is ' + this.filter('fastest').pluck('name'));
})
.run({ 'async': false });
