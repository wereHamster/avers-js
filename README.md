Avers.js
--------

Avers is a small library which aims to provide a better *model* (the M in MVC)
abstraction than traditional libraries such as [Backbone][backbone].

You describe your models in terms of properties they have. Avers takes care of
notifying you of any changes. And because avers is aware of all the
properties, it can alo provide functions which generate/parse JSON, thus
greatly reducing boilerplate code.

These properties can not only be primitive types, but also objects or
collections. This enables you to structure your models in a much more natural
way than existing libraries allow.

Avers doesn't include support for synchronizing models with a server. You may
want to use different strategies for that. One is to send complete objects to
the server. Or you may want to only send the changes to reduce the required
bandwidth. Either way, it's easy to write the code yourself by using XHR.

The implementation makes heavy use of modern web technologies, such as
[Object.observe][object-observe]. Though it's possible to use Avers on older
browsers if you load an *Object.observe* shim.

Avers is ready to be used in Angular, Polymer and other web frameworks which
expect models to be plain JavaScript objects.


Example
-------

An example is available in the example/ subdirectory. To use it, first install
the dependencies and then open the index file in your browser:

    npm install
    open ./example/index.html

Open the developer console and play around with the `library` object.


Documentation
-------------

You can make any of your existing classes an *Avers* class, simply by doing
these two things:

 - Define properties on your class.
 - And call `Avers.initializeProperties(this)` in the constructor.

There are three types of properties:

 - Primitive values (string, number, boolean).
 - Child objects (Avers classes).
 - Collections (arrays of Avers classes).

```javascript
    function Author() {
        Avers.initializeProperties(this);
    }

    Avers.definePrimitive(Author, 'firstName');
    Avers.definePrimitive(Author, 'lastName');


    function Book() {
        Avers.initializeProperties(this);
    }

    Avers.definePrimitive(Book, 'title');
    Avers.defineObject(Book, 'author', Author);

    function mkBook(title) {
        var book = new Book();

        book.title  = 'A Tale of Two Cities';
        book.author = new Author();

        return book;
    }
```

Change events bubble up to the root. The event carries the 'path' to the
changed object as well as the new value:

```javascript
    var book = mkBook('A Tale of Two Cities');
    book.on('change', function(path, value) {
        console.log("The value at path " + path + " has changed, its new value is: " + value)
    });

    book.author.firstName = 'Charles';
    book.author.lastName  = 'Dickens'
```

You should see two messages in the console, saying that 'author.firstName' and
'author.lastName' have changed'

Avers provides a function which uses the defined properties to serialize an
instance into JSON:

```javascript
    var json = Avers.toJSON(book);
    // { title: '...', author: { firstName: '...', lastName: '...' } }
```

When you register a property with `defineCollection`, avers creates a normal
javascript array, and extends it with a few functions used to manage the
changes. You can use any array functions you know and love to manipulate the
collection. But you must not assign an array to that property.

```javascript
    function Library() {
        Avers.initializeProperties(this);
    }

    Avers.defineCollection(Library, 'books', Book);

    var library = new Library;
```

Models within a collection are given a unique key which stays stable even when
you reorder the array.

```javascript
    library.books.push(book)
    // change event with: path = 'books.c3', value = book

    library.books[0].title = library.books[0].title.toLowerCase();
    // change event with path = 'books.c3.title', value = ...
```

Avers can automatically generate and parse JSON for you. Or if you have an
existing object, you can easily update it.

```javascript
    book = Avers.fromJSON(Book, {
        title: '',
        author: { firstName: '', lastName: '' }
    });

    Avers.updateObject(book.author, { firstName: '', lastName: '' });

    json = Avers.toJSON(book);
```

TODO
----

 - Consider using more event types, such as 'add', 'remove' on Collection.
 - Tests... have some, need more.

[backbone]: http://backbonejs.org/
[object-observe]: http://wiki.ecmascript.org/doku.php?id=harmony:observe
