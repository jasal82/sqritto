// @sqritto/report – editoriales Layout für Berichte und Whitepaper.
//
// Gleicher Vertrag wie @sqritto/techdoc:
//   #show: ts-document.with(title: .., subtitle: .., authors: (..), version: ..,
//                           date: .., lang: "de", ..optionen)
//
// Unterstützte Optionen:
//   abstract: str | none        Zusammenfassung unter dem Titel
//   cover: bool (false)         eigene Titelseite statt Titelblock
//   toc: bool (false)           Inhaltsverzeichnis
//   numbering: bool (true)      nummerierte Überschriften
//   accent: color (#b45309)     Akzentfarbe
//   serif: bool (true)          Serifenschrift (Libertinus Serif) für den Fließtext
//   logo: path | none, paper, organization, classification/confidential,
//   doctype (Überzeile, Standard „Bericht“), chapter-pagebreak (false)

#import "@sqritto/techdoc:0.1.0": td-config, td-labels, td-small-caps, td-meta-grid, td-toc, td-ink, td-text, td-muted, td-border
#import "@sqritto/markdoc:0.1.0": *

#let rp-cover(cfg) = page(margin: 0pt, header: none, footer: none, numbering: none, {
  let a = cfg.accent
  place(top + left, rect(width: 14mm, height: 100%, fill: a))
  place(top + left, dx: 34mm, dy: 30mm, {
    if cfg.logo != none { box(height: 12mm, image(cfg.logo, height: 12mm)) }
  })
  place(top + left, dx: 34mm, dy: 96mm, block(width: 150mm, {
    set par(justify: false, leading: 0.34em, spacing: 0pt)
    td-small-caps(cfg.doctype, fill: a, size: 8.5pt, tracking: 0.16em)
    v(7mm)
    text(font: ("Libertinus Serif",), size: 36pt, weight: "regular", fill: td-ink, cfg.title)
    if cfg.subtitle != none {
      v(7mm)
      set par(leading: 0.5em)
      text(font: ("Libertinus Serif",), size: 15pt, style: "italic", fill: td-muted, cfg.subtitle)
    }
  }))
  place(top + left, dx: 34mm, dy: 236mm, block(width: 150mm, {
    line(length: 100%, stroke: 0.6pt + td-border)
    v(6mm)
    td-meta-grid(cfg, columns: 4, with-organization: true)
  }))
})

#let rp-abstract(cfg, abstract) = {
  if abstract != none and abstract != "" {
    block(width: 100%, below: 9mm, inset: (left: 12pt, y: 2pt), stroke: (left: 2pt + cfg.accent), {
      set par(justify: true, spacing: 0.6em)
      text(font: ("Inter",), size: 7.5pt, weight: "semibold", tracking: 0.12em, fill: cfg.accent, upper(if cfg.lang == "de" { "Zusammenfassung" } else { "Abstract" }))
      parbreak()
      text(size: 10.5pt, style: "italic", fill: td-text, abstract)
    })
  }
}

#let rp-title-block(cfg) = {
  let a = cfg.accent
  block(width: 100%, below: 9mm, {
    set par(justify: false, spacing: 0pt)
    td-small-caps(cfg.doctype, fill: a, size: 8pt, tracking: 0.16em)
    v(4.5mm)
    let serif = cfg.at("serif", default: true)
    block(if serif {
      text(font: ("Libertinus Serif",), size: 30pt, fill: td-ink, top-edge: "cap-height", cfg.title)
    } else {
      text(font: ("Inter",), size: 25pt, weight: "bold", tracking: -0.01em, fill: td-ink, top-edge: "cap-height", cfg.title)
    })
    if cfg.subtitle != none {
      v(4.5mm)
      set par(leading: 0.5em)
      if serif {
        text(font: ("Libertinus Serif",), size: 14pt, style: "italic", fill: td-muted, cfg.subtitle)
      } else {
        text(font: ("Inter",), size: 12.5pt, fill: td-muted, cfg.subtitle)
      }
    }
    v(6mm)
    set text(font: ("Inter",), size: 8.5pt, fill: td-muted)
    let parts = ()
    if cfg.authors.len() > 0 { parts.push(text(fill: td-text, weight: "medium", cfg.authors.join(", "))) }
    if cfg.organization != none { parts.push(cfg.organization) }
    parts.push(cfg.date)
    if cfg.version != none { parts.push([#cfg.labels.version #cfg.version]) }
    parts.join([ #h(0.4em) · #h(0.4em) ])
    v(5mm)
    line(length: 100%, stroke: 0.6pt + td-border)
  })
}

#let ts-document(
  title: none,
  subtitle: none,
  authors: (),
  version: none,
  date: none,
  lang: "de",
  ..options,
  body,
) = {
  let o = options.named()
  let cfg = td-config(title, subtitle, authors, version, date, lang, options, doctype: if lang == "de" { "Bericht" } else { "Report" })
  if o.at("accent", default: none) == none { cfg.accent = rgb("#b45309") }
  cfg.cover = o.at("cover", default: false)
  cfg.toc = o.at("toc", default: false)
  cfg.chapter-pagebreak = o.at("chapter-pagebreak", default: false)
  let serif = o.at("serif", default: true)
  cfg.serif = serif
  let abstract = o.at("abstract", default: none)
  let a = cfg.accent
  let body-font = if serif { ("Libertinus Serif", "Inter") } else { ("Inter", "Libertinus Serif") }

  set document(title: cfg.title, author: cfg.authors)
  set text(lang: cfg.lang, font: body-font, size: if serif { 11pt } else { 10pt }, fill: td-text)
  ts-set-theme(accent: a, accent-soft: a.lighten(92%), font: body-font, size: if serif { 11pt } else { 10pt })

  set page(
    paper: cfg.paper,
    margin: (top: 28mm, bottom: 26mm, left: 30mm, right: 30mm),
    header-ascent: 40%,
    header: context {
      let start = query(<ts-body-start>)
      let in-body = start.len() > 0 and here().page() > start.first().location().page()
      if in-body {
        set text(font: ("Inter",), size: 7.5pt, fill: td-muted)
        grid(columns: (1fr, auto), td-small-caps(cfg.title, size: 7pt, tracking: 0.1em), cfg.date)
      }
    },
    footer: context {
      let start = query(<ts-body-start>)
      if start.len() > 0 and here().page() >= start.first().location().page() {
        set text(font: ("Inter",), size: 8pt, fill: td-muted)
        align(center, counter(page).display("1"))
      }
    },
  )

  show: ts-base-style

  set par(justify: serif, leading: if serif { 0.68em } else { 0.74em }, spacing: if serif { 1.05em } else { 1.2em }, first-line-indent: 0pt)
  set text(hyphenate: serif, costs: (widow: 100%, orphan: 100%))
  set list(marker: (text(fill: a, sym.bullet), [–]))
  set enum(numbering: n => text(fill: a, numbering("1.", n)))
  show link: it => text(fill: a.darken(10%), it)

  set heading(numbering: if cfg.numbering { "1.1" } else { none })
  show heading: set text(font: ("Inter",), fill: td-ink)
  show heading: set par(justify: false)
  show heading.where(level: 1): it => {
    if cfg.chapter-pagebreak { pagebreak(weak: true) }
    block(width: 100%, above: 2.4em, below: 1.1em, sticky: true, {
      set text(size: 15pt, weight: "semibold")
      if it.numbering != none {
        text(fill: a, context counter(heading).display("1"))
        h(0.7em)
      }
      it.body
    })
  }
  show heading.where(level: 2): it => block(width: 100%, above: 1.9em, below: 0.9em, sticky: true, {
    set text(size: 11.5pt, weight: "semibold")
    if it.numbering != none {
      text(fill: td-muted, context counter(heading).display(it.numbering))
      h(0.6em)
    }
    it.body
  })
  show heading.where(level: 3): it => block(above: 1.6em, below: 0.8em, sticky: true, text(size: 10.5pt, weight: "semibold", it.body))
  show heading.where(level: 4): it => block(above: 1.4em, below: 0.6em, sticky: true, text(size: 10pt, weight: "semibold", style: "italic", it.body))

  show figure.caption: it => {
    set text(size: 9pt, fill: td-muted)
    [#text(font: ("Inter",), size: 8pt, weight: "semibold", fill: td-text)[#it.supplement #context it.counter.display(it.numbering)]#it.separator#it.body]
  }

  if cfg.cover { rp-cover(cfg) }
  if cfg.toc { td-toc(cfg) }
  [#metadata("ts-body-start") <ts-body-start>]
  counter(page).update(1)
  if not cfg.cover { rp-title-block(cfg) }
  rp-abstract(cfg, abstract)
  body
}
