Avers.js
--------

Avers is a JavaScript library which serves two purposes:

 - Provides a DSL to define object types and their properties. You can parse
   JSON into these types and generate JSON from instances of these types.

 - Tracks changes made to these objects. The changes propagate through the
   object hierarchy up to the root, where you can listen and act upon them.

You can think of Avers as providing a better *Model* in a MVC application.
Avers is compatible with Angular, Polymer and other web frameworks which
expect models to be plain JavaScript objects. But it also works equally well
with frameworks which expect immutable data.

Avers is written in ES6 compatible JavaScript. It depends on some features
which are only available in modern JavaScript runtimes. If your runtime
doesn't provide these requirements, you'll have to load polyfills. See further
below what Avers requires and which runtimes provide these requirements out of
the box.

The library doesn't include support for synchronizing these objects with
a server. You are only notified of changes, how you process them is up to
you. If you want to persist them on your server, you can serialize the whole
object and send it over, or send only the change (which is usually very
small). Either way, it's easy to write the code yourself by using XHR.

The code is written in [TypeScript][typescript]. To use Avers in a plain
JavaScript project, first compile `avers.ts` and then load it in your project.

Weight is about 21k raw, 6k compressed (uglify or google closure compiler).
I haven't put much effort into making the code compact, so there certainly is
some space for improvement.

## Requirements

The implementation makes heavy use of modern web technologies, such as
[Object.observe][object-observe], [Symbol][symbol], [Map][map] and [Set][set].
It is compatible with the following runtimes out of the box:

 - Chrome (40+)
 - io.js (1.1.0+)

On older runtimes you'll have to load a polyfill or shim.


## Example

First you want to define your objects and the properties they have. There are
four types of properties:

 - Primitive values (string, number, boolean).
 - Variant properties (also sometimes called sum types).
 - Child objects (Avers objects).
 - Collections (arrays of Avers objects).


```javascript
function Author() {}
Avers.definePrimitive(Author, 'firstName');
Avers.definePrimitive(Author, 'lastName');

function Book() {}
Avers.definePrimitive(Book, 'title');
Avers.defineObject(Book, 'author', Author);

function Library() {}
Avers.defineCollection(Library, 'books', Book);
```

Parse JSON into instances of these objects:

```javascript
var book = Avers.parseJSON
  ( Book
  , { title  : '1984'
    , author :
      { firstName : 'George'
      , lastName  : 'Orwell'
      }
    }
  );

var library = Avers.mk(Library, {});
library.books.push(book);

assert(book instanceof Book);
assert(library.books.length === 1);
```

Attach change listeners to the instance. Change events bubble up to the root.
The change carries the 'path' to the changed object as well as details about
the type of change (set or splice).

```javascript
Avers.attachChangeListener(library, function(changes) {
    changes.forEach(function(change) {
        console.log(change.path, change.record);
    });
});
```

# Avers.Storage Extension

The `avers.storage.ts` file extends the `Avers` module with functionality to
manage and synchronize objects with a compliant server (one implementation is
available as a [Haskell library][avers-haskell] library).

All data is managed in a `Handle`. Initialize it with the base URL to the API
server, the `fetch` function which is used to send out network requests, and
a table with all object types which you want to support.

```javascript
var infoTable = { book: Book };
var h = new Avers.Handle('//api.domain.tld', fetch.bind(window), infoTable);
```

The handle has a `generationNumber` property. It is a number, incremented
every time any data managed by the handle changes. Use it to detect when you
need to re-render the UI (eg. by using `Object.observe`).

The extension defines a new type, `Editable<T>`, which wraps a top-level
object with metadata needed for synchronization (such as whether it has been
loaded or not, any local changes you have done to the object, or the network
request in flight).

Many of the functions return either a `Promise` or a `Computation`. For
example to lookup an object in your react Rendering function, use
`lookupEditable`. It returns a `Computation`, so make sure to

```javascript
class BookSummary extends React.Component<P, S> {
    render() {
        return Avers.lookupEditable<Book>(aversH, this.props.bookId).fmap(e => {
            var book   = e.content
              , author = book.author;

            return <span>{book.title} by {author.firstName} {author.lastName}</span>;

        ).get(<span>Loading book {this.props.bookId}...</span>);
    }
}
```




[typescript]: http://www.typescriptlang.org/
[object-observe]: http://www.html5rocks.com/en/tutorials/es7/observe/
[symbol]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol
[map]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
[set]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
[avers-haskell]: https://github.com/wereHamster/avers-haskell/
