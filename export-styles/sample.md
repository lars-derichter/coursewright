---
title: "Style Sample"
subtitle: "Every element an export can contain"
course: "Example course"
date: "2026-08-10"
lang: en
toc: true
# The sample is language-independent, so the labels are pinned here. Real
# exports get this block generated from course.config.yml: it doubles as a
# live example of what the exporter emits.
labels:
  note: "Note"
  tip: "Tip"
  important: "Important"
  warning: "Warning"
  caution: "Caution"
  check: "Check"
  attachment: "Attachment:"
---

# First Chapter

An ordinary paragraph with **bold**, _italic_ and a
[link to example.com](https://example.com), so you can judge how running text
sits in the style. Typst handles the line breaking and hyphenation itself.

## A Subheading

A second paragraph, to show the vertical rhythm between headings and text. Here
is some `inline code` in the middle of a sentence.

### A Sub-Subheading

A short paragraph under the third heading level. This sentence carries a
footnote so you can see how notes are set.[^1]

[^1]: This is what a footnote looks like at the foot of the page.

#### A Fourth Heading Level

The fourth level is the last one that is numbered.

##### A Fifth Heading Level

Levels five and six are small label headings rather than numbered sections.

## Quotation and Definitions

A block quotation:

> Education is not the filling of a pail, but the lighting of a fire.

A definition list:

Selector : A pattern that decides which elements a CSS rule applies to.

Markup : The structure of a document, expressed in tags.

A horizontal rule as a separator:

---

## Image

![The export style's cover logo, used here as a sample image](logo.png)

## Alerts

::: {.alert .note}
A note alert, for context and background.
:::

::: {.alert .tip}
A tip alert with a useful suggestion.
:::

::: {.alert .important}
An important alert that asks for attention.
:::

::: {.alert .warning}
A warning alert.
:::

::: {.alert .caution}
A caution alert, for risks.
:::

::: {.alert .check}
A check alert, for a checkpoint or a self-test.
:::

## Code

A code block in JavaScript:

```js
function greet(name) {
  console.log(`Hello, ${name}!`);
}
greet("world");
```

## Lists

An unordered list:

- First item
- Second item
- Third item

An ordered list:

1. Step one
2. Step two
3. Step three

## Table

| Column A | Column B | Column C |
| -------- | -------- | -------- |
| 1        | 2        | 3        |
| a        | b        | c        |

## Special Blocks

::: {.link-card title="External resource" url="https://example.com/article"}
:::

::: {.attachment name="example-document.pdf"}
:::

::: {.page-break}
:::

# Second Chapter

This chapter starts on a new page, so you can see how an H1 forces the page
break.
