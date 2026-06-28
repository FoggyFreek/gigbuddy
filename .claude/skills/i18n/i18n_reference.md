# Example project
https://github.com/i18next/next-i18next/tree/master/examples/pages-router-simple



# Best Practices

### Implications of interpolation for localization

When translating into other languages, interpolation causes real problems. Fundamentally, what interpolation does is concatenate pieces of text. English sentences split into sentence fragments and programmatically constructed at runtime are difficult and sometimes impossible to translate, unless you have implemented multilingual grammar rules, which is rare.

Use interpolation sparingly to minimize issues with localization. Interpolation cannot be avoided for values that can only be known at runtime, such as:

* Time stamps
* User-inputted data

When values are known and available for translation in a resource file, interpolation should be avoided. Use multiple self-contained string values instead.

#### Example

Suppose you want to use interpolation to replace the value for `{paymentType}` in the following key

```
{
    "key": "All fees will be charged to the {{paymentType}} on file for this account."
}
```

wherein `{paymentType}` could be 'credit card' or 'PayPal account'.

In German the spelling of the word "the" preceding `{paymentType}` must change depending on which value is passed.

```
{
    "key": "Alle Beträge werden dem {{paymentType}} für dieses Konto in Rechnung gestellt."
}
```

The result is some runtime strings will be broken

// -> "Alle Beträge werden dem Kreditkarte für dieses Konto in Rechnung gestellt." <- 'dem Kreditkarte' should be 'der Kreditkarte'

// -> "Alle Beträge werden dem PayPal-Konto für dieses Konto in Rechnung gestellt." <- 'dem PayPal-Konto' is correct

This is just one simple example of a very complex localization problem.

Use two separate fully self-contained strings instead:

```
{
    "key1": "All fees will be charged to the credit card on file for this account."
    "key2": "All fees will be charged to the PayPal account on file for this account."

}
```
# Translation Resolution

The process of translating keys is the heart of i18next, and as such this document should serve as a guide to the overall process by which i18next attempts to translate your keys into the appropriate content for a given location, be it on a specific page and/or for a user in a particular region of the world.

## Core Elements

### Keys

A key is not unlike a key in any object structure, like JSON or a dictionary in Python. A key is a specific set of text that, when looked up, provides a corresponding value.

#### Example:

```
"key": "value"
```

This example shows the very core concept of what a key is capable of expressing, but the ability to express this formally is very important, as it allows us to expand its utility going forward.

Keys are a very powerful way of specifying the different forms of an element, be it a piece of text or other forms of content, into its potential variations.

For more information on all of the different ways keys can be used, please see the documentation for the [translation function](/translation-function/essentials.md).

### Languages

A language is what you would expect: the idiom to be used for translating a key. When we look for a key, we specify a language with it, so that we know which version of the key to use. The important thing to note about this is that *if a key is not found, you can* [*gracefully fall back to a parent language or a default one*](/principles/fallback.md).

In i18next, a language is a particular value which can be known as a "code". A language code can be expressed in variety of ways, but they generally look something like the following example:

#### Example:

```
"en-US"
```

Long story short, you'll either use a "pure language" code, such as `en` or `de` for English and German, or a language + a variant identification, such as `pt-BR` for the Brazilian Portuguese, `es-419` for Latin American Spanish, or `zh-cmn-Hant-HK` which is Chinese in the Mandarin variation, written in the Traditional script, as used in Hong Kong. For more information on the subject, it is recommended to read up on [IETF Language Codes](https://en.wikipedia.org/wiki/IETF_language_tag).

### Namespaces

A namespace can be thought of as logical groupings of different sets of translations.

For instance, you might have a 3 sections of your app, each with many individual pages in them, but only 2 sections share similar content. If that's the case, instead of loading all of the keys for all 3 sections, you can instead load keys from a "shared" set of translations and break up the other sections into much smaller sets of keys, loading them as needed.

In a given namespace you could have a set of languages, each with its own set of keys.

#### Example

```
"common" // Things that are reused everywhere, like "Confirm" and "Cancel" on buttons
"validation" // All validation text, like "email address not valid" in a form
"glossary" // Words we want to be reused consistently, like key words in your app
```

For more information on the concept of namespaces and how you might want to use them, please see their [documentation](/principles/namespaces.md).

## Resolution Order

By default, when translating a key, i18next tries the first combination of your **namespace**, **language**, and **key**.

However, if that does not work, i18next attempts to [gracefully fallback](/principles/fallback.md) to a different combination in order to provide the most relevant translation for a piece of content. The core idea is to try to find a key that exists, from *most specific to least specific*. Here is the process that it uses by default:

#### 1. Similar Keys

If the specific key is not found, i18next tries to match the key you are looking for with a similar key, looking for a key that best fits the **plural** form, **context**, and **singular** form in that order.

#### 2. Languages

If a key is not found, i18next then walks through the list of languages, which consists of the **current language(s)** and the **fallback language(s)**.

#### 3. Namespaces

If no language matches, i18next walks through the list of namespaces, which similarly to languages, consists of the **current namespace(s)** and the **fallback namespace(s)**.

#### 4. Fallback Keys

If that key is still not found, i18n will walk through this process with the **fallback key(s)**, if specified.

#### 5. Key Not Found

If the key is still not found, i18n will then return the **key itself**, that being the first key specified if you also specified fallback keys.

For more information on each method of fallback, please see the [fallback documentation](/principles/fallback.md).

# Language Namespaces

Separate some segments out because they belong together.

common.json -> Things that are reused everywhere, eg. Button labels 'save', 'cancel'

validation.json -> All validation texts

glossary.json -> Words we want to be reused consistently inside texts

More often you don't want to load all the translations upfront or at least reduce the amount loaded. This reason often goes hand in hand with the one translation file gets too large and you start losing the overview scrolling through hundreds of text fragments.

namespace per view/page
namespace per application section / feature set (admin area, ...)
namespace per module which gets lazy loaded (single page applications)

src 
└── i18n
    ├── en
    │   ├── ns1.json
    │   └── ns2.json
    └── nl
        ├── ns1.json
        └── ns2.json

## Loading namespaces

// load multiple namespaces
// the t function will be set to first namespace as default
const { t, i18n } = useTranslation(['ns1', 'ns2', 'ns3']);
t($ => $.key); // will be looked up from namespace ns1
t($ => $.key, { ns: 'ns2' }); // will be looked up from namespace ns2

// since react-i18next v17.0.7 / i18next v26.0.10 a selector path whose first
// segment matches a *secondary* namespace is routed to that namespace too:
t($ => $.ns2.key); // will be looked up from namespace ns2
t($ => $.ns3.deep.key); // will be looked up from namespace ns3
// the primary namespace ('ns1' here) is never rewritten — `$.ns1.key` would
// mean a literal sub-key inside ns1 rather than a switch.

## Optional keyPrefix option

/ having JSON in namespace "translation" like this:
/*{
    "very": {
      "deeply": {
        "nested": {
          "key": "here"
        }
      }
    }
}*/
// you can define a keyPrefix to be used for the resulting t function
const { t } = useTranslation('translation', { keyPrefix: 'very.deeply.nested' });
const text = t($ => $.key); // "here"


/* language */
i18next.language;
// Is set to the current detected or set language.

/* languages */
i18next.languages;
// Is set to an array of language codes that will be used to look up the translation value.
// When the language is set, this array is populated with the new language codes.
// Unless overridden, this array is populated with less-specific versions of that code for fallback purposes, followed by the list of fallback languages

// initialize with fallback languages
i18next.init({
  fallbackLng: ["es", "fr", "en-US", "dev"]
});
// change the language
i18next.changeLanguage("en-US-xx");
// new language and its more generic forms, followed by fallbacks
i18next.languages; // ["en-US-xx", "en-US", "en", "es", "fr", "dev"]
// change the language again
i18next.changeLanguage("de-DE");
// previous language is not retained
i18next.languages; // ["de-DE", "de", "es", "fr", "en-US", "dev"]

/* resolvedLanguage */
i18next.resolvedLanguage;
// Is set to the current resolved language.
// It can be used as primary used language,
// for example in a language switcher.


# Plurals

## keys

{
  "key_one": "item",
  "key_other": "items",
  "keyWithCount_one": "{{count}} item",
  "keyWithCount_other": "{{count}} items"
}

## usage
i18next.t($ => $.key, {count: 0}); // -> "items"
i18next.t($ => $.key, {count: 1}); // -> "item"
i18next.t($ => $.key, {count: 5}); // -> "items"
i18next.t($ => $.key, {count: 100}); // -> "items"
i18next.t($ => $.keyWithCount, {count: 0}); // -> "0 items"
i18next.t($ => $.keyWithCount, {count: 1}); // -> "1 item"
i18next.t($ => $.keyWithCount, {count: 5}); // -> "5 items"
i18next.t($ => $.keyWithCount, {count: 100}); // -> "100 items"

# Interpolation
 It allows integrating dynamic values into your translations. Per default, interpolation values get escaped to mitigate XSS attacks.




# Interpolation

## Basic
### keys
Keys, by default, are strings surrounded by curly brackets:

{
    "key": "{{what}} is {{how}}"
}

### sample

i18next.t($ => $.key, { what: 'i18next', how: 'great' });
// -> "i18next is great"

## working with data models

You can also pass entire data models as a value for interpolation.


### keys
{
    "key": "I am {{author.name}}"
}

### sample
const author = { 
    name: 'Jan',
    github: 'jamuhl'
};
i18next.t($ => $.key, { author });
// -> "I am Jan"


## Unescape
By default, the values get escaped to mitigate XSS attacks. You can toggle escaping off, by either putting - before the key, or set the escapeValue option to false when requesting a translation.

### keys
{
    "keyEscaped": "no danger {{myVar}}",
    "keyUnescaped": "dangerous {{- myVar}}"
}

### sample

i18next.t($ => $.keyEscaped, { myVar: '<img />' });
// -> "no danger &lt;img &#x2F;&gt;"

i18next.t($ => $.keyUnescaped, { myVar: '<img />' });
// -> "dangerous <img />"

i18next.t($ => $.keyEscaped, { myVar: '<img />', interpolation: { escapeValue: false } });
// -> "no danger <img />" (obviously could be dangerous)

# Formatting

## Basic usage
The translation string has the following signature:


{
  "key": "Some format {{value, formatname}}",
  "keyWithOptions": "Some format {{value, formatname(option1Name: option1Value; option2Name: option2Value)}}"
}
Use a "semicolon" delimited list of options.


TypeScript
Passing options to the formatting:
In the translation string using {{value, formatname(options1: options1Value)}}
Using the root level options when calling t($ => $.key, { option1: option1Value })
Using the per value options like: t($ => $.key, { formatParams: { value: { option1: option1Value } })

### Samples
{
  "intlNumber": "Some {{val, number}}",
  "intlNumberWithOptions": "Some {{val, number(minimumFractionDigits: 2)}}"
}

i18next.t($ => $.intlNumber, { val: 1000 });
// --> Some 1,000
i18next.t($ => $.intlNumber, { val: 1000.1, minimumFractionDigits: 3 });
// --> Some 1,000.100
i18next.t($ => $.intlNumber, { val: 1000.1, formatParams: { val: { minimumFractionDigits: 3 } } });
// --> Some 1,000.100
i18next.t($ => $.intlNumberWithOptions, { val: 2000 });
// --> Some 2,000.00
i18next.t($ => $.intlNumberWithOptions, { val: 2000, minimumFractionDigits: 3 });
// --> Some 2,000.000


## Overriding the language to use
The language can be overridden by passing it in t.options

i18next.t($ => $.intlNumber, { val: 1000.1, lng: 'de' }); 
// or: i18next.t($ => $.intlNumber, { val: 1000.1, locale: 'de' });
i18next.t($ => $.intlNumber, { val: 1000.1, formatParams: { val: { lng: 'de' } } }); 
// or: i18next.t($ => $.intlNumber, { val: 1000.1, formatParams: { val: { locale: 'de' } } });
Adding custom format function
It's rather simple to add own function:

// after i18next.init(options);
i18next.services.formatter.add('lowercase', (value, lng, options) => {
  return value.toLowerCase();
});

i18next.services.formatter.add('underscore', (value, lng, options) => {
  return value.replace(/\s+/g, '_');
});

Make sure you add your custom format function AFTER the i18next.init() call.
There's also an addCached version for optimized performance:

i18next.services.formatter.addCached('specialformat', (lng, options) => {
  const formatter = new Intl.NumberFormat(lng, options);
  return (val) => formatter.format(val);
});

## Using multiple formatters

{
  "key": "Some format {{value, formatter1, formatter2}}"
}

## Built-in formats
### Number
{
  "intlNumber": "Some {{val, number}}",
  "intlNumberWithOptions": "Some {{val, number(minimumFractionDigits: 2)}}"
}

i18next.t($ => $.intlNumber, { val: 1000 });
// --> Some 1,000
i18next.t($ => $.intlNumber, { val: 1000.1, minimumFractionDigits: 3 });
// --> Some 1,000.100
i18next.t($ => $.intlNumber, { val: 1000.1, formatParams: { val: { minimumFractionDigits: 3 } } });
// --> Some 1,000.100
i18next.t($ => $.intlNumberWithOptions, { val: 2000 });
// --> Some 2,000.00
i18next.t($ => $.intlNumberWithOptions, { val: 2000, minimumFractionDigits: 3 });
// --> Some 2,000.000
For options see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat

### Currency

{
  "intlCurrencyWithOptionsSimplified": "The value is {{val, currency(USD)}}",
  "intlCurrencyWithOptions": "The value is {{val, currency(currency: USD)}}",
  "twoIntlCurrencyWithUniqueFormatOptions": "The value is {{localValue, currency}} or {{altValue, currency}}",
}

i18next.t($ => $.intlCurrencyWithOptionsSimplified, { val: 2000 });
// --> The value is $2,000.00
i18next.t($ => $.intlCurrencyWithOptions, { val: 2300 });
// --> The value is $2,300.00
i18next.t($ => $.twoIntlCurrencyWithUniqueFormatOptions,
          {
            localValue: 12345.67,
            altValue: 16543.21,
            formatParams: {
              localValue: { currency: 'USD', locale: 'en-US' },
              altValue: { currency: 'CAD', locale: 'fr-CA' },
            },
          },);
// --> The value is $12,345.67 or 16 543,21 $ CA
For options see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat

### DateTime

{
  "intlDateTime": "On the {{val, datetime}}",
}

i18next.t($ => $.intlDateTime, { val: new Date(Date.UTC(2012, 11, 20, 3, 0, 0)) });
// --> On the 12/20/2012
i18next.t($ => $.intlDateTime,
          {
            val: new Date(Date.UTC(2012, 11, 20, 3, 0, 0)),
            formatParams: {
              val: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
            },
          });
// --> On the Thursday, December 20, 2012
For options see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat

### RelativeTime

{
  "intlRelativeTime": "Lorem {{val, relativetime}}",
  "intlRelativeTimeWithOptions": "Lorem {{val, relativetime(quarter)}}",
  "intlRelativeTimeWithOptionsExplicit": "Lorem {{val, relativetime(range: quarter; style: narrow;)}}",
}

i18next.t($ => $.intlRelativeTime, { val: 3 });
// --> Lorem in 3 days
i18next.t($ => $.intlRelativeTimeWithOptions, { val: -3 });
// --> Lorem 3 quarters ago
i18next.t($ => $.intlRelativeTimeWithOptionsExplicit, { val: -3 });
// --> Lorem 3 qtrs. ago
i18next.t($ => $.intlRelativeTimeWithOptionsExplicit, { val: -3, style: 'long' });
// --> Lorem 3 quarters ago
For options see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat

### List

{
  "intlList": "A list of {{val, list}}"
}

i18next.t($ => $.intlList, { val: ['locize', 'i18next', 'awesomeness'] });
// --> A list of locize, i18next, and awesomeness