// @sqritto/markdoc – Basisbibliothek für Markdoc-Dokumente.
//
// Die Markdoc-Engine erzeugt Aufrufe der hier definierten `ts-*`-Funktionen.
// Layout-Vorlagen (z. B. @sqritto/techdoc) importieren diese Bibliothek,
// setzen das Theme über `ts-set-theme` und können jede Funktion überschreiben.

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

#let ts-default-theme = (
  accent: rgb("#2563eb"),
  accent-soft: rgb("#eff6ff"),
  ink: rgb("#0f172a"),
  text: rgb("#1e293b"),
  muted: rgb("#64748b"),
  border: rgb("#e2e8f0"),
  surface: rgb("#f8fafc"),
  code-bg: rgb("#f6f8fa"),
  code-border: rgb("#e2e8f0"),
  font: ("Inter", "Libertinus Serif"),
  heading-font: ("Inter", "Libertinus Serif"),
  mono: ("JetBrains Mono", "DejaVu Sans Mono"),
  size: 10.5pt,
  radius: 4pt,
)

#let ts-theme = state("ts-theme", ts-default-theme)

/// Überschreibt einzelne Theme-Werte, z. B. `ts-set-theme(accent: red)`.
#let ts-set-theme(..args) = ts-theme.update(t => t + args.named())

/// Farbe aus Theme oder Hex-String auflösen.
#let ts-color(value, fallback: none) = {
  if type(value) == color { value }
  else if type(value) == str and value.starts-with("#") { rgb(value) }
  else { fallback }
}

// ---------------------------------------------------------------------------
// Sprache der Beschriftungen
// ---------------------------------------------------------------------------

/// Sprache für Beschriftungen zu einer Dokumentsprache: "de" für Deutsch,
/// jede andere Sprache erhält Englisch.
#let ts-label-lang(lang) = if lang == "de" { "de" } else { "en" }

/// Wählt aus `(de: …, en: …)` den Eintrag zur aktuellen Textsprache
/// (`text.lang`, gesetzt über `lang` in sqritto.toml). Nur innerhalb von
/// `context` aufrufen, z. B. `context ts-i18n((de: "Hinweis", en: "Note"))`.
#let ts-i18n(labels) = labels.at(ts-label-lang(text.lang), default: labels.at("en", default: none))

/// Datum in der Schreibweise der Sprache: „26.10.2026“ bzw. „October 26, 2026“.
#let ts-format-date(date, lang: "de") = if ts-label-lang(lang) == "de" {
  date.display("[day].[month].[year]")
} else {
  date.display("[month repr:long] [day padding:none], [year]")
}

/// Wandelt Angaben wie "60%", "300px", "4cm" in Typst-Längen um.
#let ts-length(value, default: auto) = {
  if value == none or value == auto or value == "" { return default }
  if type(value) in (length, ratio, relative, fraction) { return value }
  let s = str(value).trim()
  let num(suffix) = float(s.slice(0, s.len() - suffix.len()).trim())
  if s.ends-with("%") { num("%") * 1% }
  else if s.ends-with("px") { num("px") * 0.75pt }
  else if s.ends-with("pt") { num("pt") * 1pt }
  else if s.ends-with("mm") { num("mm") * 1mm }
  else if s.ends-with("cm") { num("cm") * 1cm }
  else if s.ends-with("em") { num("em") * 1em }
  else if s.ends-with("in") { num("in") * 1in }
  else { float(s) * 0.75pt }
}

// ---------------------------------------------------------------------------
// Grundelemente
// ---------------------------------------------------------------------------

#let ts-hr() = context {
  let t = ts-theme.get()
  v(0.4em)
  line(length: 100%, stroke: 0.6pt + t.border)
  v(0.4em)
}

#let ts-checkbox(done) = context {
  let t = ts-theme.get()
  box(
    width: 0.85em,
    height: 0.85em,
    baseline: 0.1em,
    radius: 2pt,
    stroke: 0.8pt + if done { t.accent } else { t.muted },
    fill: if done { t.accent } else { none },
    align(center + horizon, if done { text(fill: white, size: 0.7em, weight: "bold", sym.checkmark) }),
  )
  h(0.35em)
}

#let ts-broken-link(body) = context {
  let t = ts-theme.get()
  text(fill: t.muted, body)
}

#let ts-missing-image(url, alt: none) = context {
  let t = ts-theme.get()
  block(
    width: 100%,
    inset: 10pt,
    radius: t.radius,
    stroke: (dash: "dashed", paint: t.border, thickness: 0.8pt),
    text(size: 0.85em, fill: t.muted)[#ts-i18n((de: "Bild nicht eingebettet", en: "Image not embedded")): #if alt != none and alt != "" [#alt – ] #raw(url)],
  )
}

#let ts-inline-image(src, alt: none) = box(baseline: 0.15em, image(src, alt: alt, height: 1.1em))

#let ts-figure(src, alt: none, caption: none, width: auto) = {
  let img = image(src, alt: alt, width: width)
  if caption != none {
    figure(img, caption: caption)
  } else {
    block(width: 100%, align(center, img))
  }
}

#let ts-code(lang: none, title: none, lines: false, code) = context {
  let t = ts-theme.get()
  let body = {
    show raw.line: it => if lines {
      box(width: 2.2em, align(right, text(fill: t.muted, size: 0.85em, str(it.number))))
      h(0.9em)
      it.body
    } else { it }
    raw(code, lang: lang, block: true)
  }
  block(
    width: 100%,
    breakable: true,
    radius: t.radius,
    stroke: 0.6pt + t.code-border,
    fill: t.code-bg,
    clip: true,
    above: 1em,
    below: 1em,
    {
      if title != none {
        block(
          width: 100%,
          inset: (x: 10pt, y: 6pt),
          below: 0pt,
          fill: t.code-border.lighten(45%),
          stroke: (bottom: 0.6pt + t.code-border),
          text(font: t.mono, size: 0.78em, fill: t.muted, title),
        )
      }
      block(width: 100%, inset: (x: 11pt, y: 9pt), above: 0pt, body)
    },
  )
}

#let ts-table(columns: 1, align: (), header: (), ..cells) = context {
  let t = ts-theme.get()
  let al = if align.len() == 0 { auto } else { align.map(a => if a == auto { left } else { a }) }
  let has-header = header.len() > 0
  // Volle Satzbreite: die letzte linksbündige Spalte füllt auf, alle anderen
  // Spalten sind so breit wie ihr Inhalt.
  let cols = if type(columns) == int {
    if columns <= 1 { (1fr,) } else {
      let aligns = if type(al) == array { al } else { (left,) * columns }
      let flex = columns - 1
      for i in range(columns) {
        let x = aligns.at(i, default: left)
        if x == left or x == auto { flex = i }
      }
      range(columns).map(i => if i == flex { 1fr } else { auto })
    }
  } else { columns }
  show table.cell.where(y: 0): it => if has-header { text(weight: "semibold", fill: t.ink, it) } else { it }
  set par(justify: false)
  block(width: 100%, above: 1.2em, below: 1.2em, table(
    columns: cols,
    align: al,
    inset: (x: 8pt, y: 6.5pt),
    stroke: (x, y) => (
      top: if y == 0 { 0.8pt + t.border.darken(8%) } else { 0pt },
      bottom: if has-header and y == 0 { 0.8pt + t.border.darken(8%) } else { 0.5pt + t.border },
    ),
    fill: (x, y) => if has-header and y == 0 { t.surface } else { none },
    ..(if has-header { (table.header(..header),) } else { () }),
    ..cells.pos(),
  ))
}

#let ts-math(code) = math.equation(block: true, eval(code, mode: "math"))

// ---------------------------------------------------------------------------
// Standard-Dokument (wird von Layout-Vorlagen überschrieben)
// ---------------------------------------------------------------------------

/// Gemeinsame Typografie für alle Markdoc-Dokumente.
#let ts-base-style(body) = context {
  let t = ts-theme.get()
  set text(font: t.font, size: t.size, fill: t.text, hyphenate: true)
  set par(justify: true, leading: 0.68em, spacing: 1.05em)
  // Typst verkleinert raw intern auf 0.8em; 1.08em ergibt ca. 0.86em.
  show raw: set text(font: t.mono, size: 1.08em)
  show raw.where(block: false): it => box(
    fill: t.code-bg.darken(2.5%),
    inset: (x: 2.5pt, y: 0pt),
    outset: (y: 2.6pt),
    radius: 2.5pt,
    text(fill: t.ink, it),
  )
  show link: it => {
    if type(it.dest) == str { text(fill: t.accent, it) } else { text(fill: t.accent, it) }
  }
  show heading: set text(font: t.heading-font, fill: t.ink)
  show heading: set block(above: 1.6em, below: 0.8em)
  show figure.caption: set text(size: 0.88em, fill: t.muted)
  set list(indent: 0.4em, body-indent: 0.6em, marker: ([•], [‣], [–]))
  set enum(indent: 0.4em, body-indent: 0.6em)
  show quote.where(block: true): it => block(
    width: 100%,
    inset: (left: 12pt, y: 4pt),
    stroke: (left: 2.5pt + t.border),
    text(fill: t.muted, it.body),
  )
  body
}

#let ts-document(
  title: none,
  subtitle: none,
  authors: (),
  date: none,
  version: none,
  lang: "de",
  toc: true,
  numbering: true,
  paper: "a4",
  meta: (:),
  body,
) = {
  set document(title: title, author: authors)
  set text(lang: lang)
  set page(paper: paper, margin: (x: 2.2cm, y: 2.4cm), numbering: "1")
  set heading(numbering: if numbering { "1.1" } else { none })
  show: ts-base-style
  if title != none {
    block(below: 1.5em, {
      text(size: 2em, weight: "bold", title)
      if subtitle != none { linebreak(); text(size: 1.2em, subtitle) }
    })
  }
  if toc { outline(depth: 3); pagebreak(weak: true) }
  body
}
