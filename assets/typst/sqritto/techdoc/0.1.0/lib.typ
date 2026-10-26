// @sqritto/techdoc – Layout für technische Dokumentation.
//
// Vertrag (wird von Sqritto für Markdoc-Dokumente aufgerufen):
//   #show: ts-document.with(title: .., subtitle: .., authors: (..), version: ..,
//                           date: .., lang: "de", ..optionen)
// Unbekannte Optionen werden ignoriert.
//
// Unterstützte Optionen:
//   toc: bool (true)            Inhaltsverzeichnis
//   numbering: bool (true)      nummerierte Überschriften „1.1“
//   cover: bool (true)          Titelseite
//   accent: color (#2563eb)     Akzentfarbe (auch für Komponenten)
//   logo: path | none           Logo auf Titelseite und in der Kopfzeile
//   paper: str ("a4")
//   organization: str           Herausgeber (Titelseite, Fußzeile)
//   classification / confidential: str   Schutzklasse (Titelseite, Fußzeile)
//   doctype: str                Überzeile auf der Titelseite
//   chapter-pagebreak: bool (true)  jede Markdoc-Seite/jedes Kapitel auf neuer Seite

#import "@sqritto/markdoc:0.1.0": *

#let td-labels = (
  de: (
    toc: "Inhalt",
    version: "Version",
    date: "Stand",
    authors: "Autoren",
    author: "Autor",
    page: "Seite",
    of: "von",
    chapter: "Kapitel",
    classification: "Klassifizierung",
    doctype: "Technische Dokumentation",
    organization: "Herausgeber",
    docid: "Dokument",
  ),
  en: (
    toc: "Contents",
    version: "Version",
    date: "Date",
    authors: "Authors",
    author: "Author",
    page: "Page",
    of: "of",
    chapter: "Chapter",
    classification: "Classification",
    doctype: "Technical Documentation",
    organization: "Publisher",
    docid: "Document",
  ),
)

#let td-ink = rgb("#0f172a")
#let td-text = rgb("#1e293b")
#let td-muted = rgb("#64748b")
#let td-border = rgb("#e2e8f0")

/// Liest die gemeinsamen Optionen aus und vervollständigt sie.
#let td-config(title, subtitle, authors, version, date, lang, options, doctype: none) = {
  let o = options.named()
  // Beschriftungen: Deutsch für "de", jede andere Sprache Englisch.
  let L = td-labels.at(ts-label-lang(lang))
  let accent = ts-color(o.at("accent", default: none), fallback: rgb("#2563eb"))
  let authors = if type(authors) == str { (authors,) } else if authors == none { () } else { authors }
  let authors = authors.filter(a => a != none and a != "")
  let title = if title == none or title == "" { if lang == "de" { "Unbenanntes Dokument" } else { "Untitled document" } } else { title }
  let subtitle = if subtitle == "" { none } else { subtitle }
  let version = if version == "" { none } else { version }
  (
    title: title,
    subtitle: subtitle,
    authors: authors,
    version: version,
    date: if date == none or date == auto or date == "" { ts-format-date(datetime.today(), lang: lang) } else { date },
    lang: lang,
    labels: L,
    accent: accent,
    toc: o.at("toc", default: true),
    numbering: o.at("numbering", default: true),
    cover: o.at("cover", default: true),
    paper: o.at("paper", default: "a4"),
    logo: o.at("logo", default: none),
    organization: o.at("organization", default: none),
    classification: o.at("classification", default: o.at("confidential", default: none)),
    doctype: o.at("doctype", default: if doctype != none { doctype } else { L.doctype }),
    chapter-pagebreak: o.at("chapter-pagebreak", default: true),
    footer-note: o.at("footer-note", default: none),
    options: o,
  )
}

#let td-small-caps(body, size: 7.5pt, fill: td-muted, tracking: 0.08em) = text(
  size: size,
  weight: "semibold",
  fill: fill,
  tracking: tracking,
  upper(body),
)

/// Metadatenblock (Version, Stand, Autoren …) für Titelseiten.
#let td-meta-grid(cfg, columns: 3, with-organization: false) = {
  let L = cfg.labels
  let items = ()
  if cfg.at("doc-id", default: none) != none { items.push((cfg.labels.at("docid", default: "Dokument"), cfg.doc-id)) }
  if cfg.version != none { items.push((L.version, cfg.version)) }
  items.push((L.date, cfg.date))
  if cfg.authors.len() > 0 {
    items.push((if cfg.authors.len() == 1 { L.author } else { L.authors }, cfg.authors.join(", ")))
  }
  if with-organization and cfg.organization != none { items.push((L.organization, cfg.organization)) }
  grid(
    columns: (1fr,) * calc.min(columns, items.len()),
    column-gutter: 8mm,
    row-gutter: 6mm,
    ..items.map(((key, val)) => {
      td-small-caps(key)
      v(1.2mm)
      text(size: 10pt, fill: td-ink, val)
    }),
  )
}

/// Titelseite der technischen Dokumentation.
#let td-cover(cfg) = page(margin: 0pt, header: none, footer: none, numbering: none, {
  let a = cfg.accent
  // Dekor: große, zarte Kreise rechts unten
  place(top + left, dx: 128mm, dy: 168mm, circle(radius: 78mm, fill: a.lighten(95%)))
  place(top + left, dx: 160mm, dy: 205mm, circle(radius: 46mm, stroke: 0.8pt + a.lighten(75%)))
  place(top + left, dx: 0mm, dy: 0mm, rect(width: 100%, height: 7mm, fill: a))

  // Kopf: Logo und Herausgeber
  place(top + left, dx: 25mm, dy: 24mm, {
    if cfg.logo != none {
      box(height: 13mm, image(cfg.logo, height: 13mm))
      if cfg.organization != none { h(4mm) }
    }
    if cfg.organization != none {
      box(baseline: -3.5mm, text(size: 10pt, weight: "semibold", fill: td-ink, cfg.organization))
    }
  })
  if cfg.classification != none {
    place(top + right, dx: -20mm, dy: 26mm, box(
      inset: (x: 7pt, y: 4pt),
      radius: 3pt,
      stroke: 0.8pt + a,
      td-small-caps(cfg.classification, fill: a, size: 7.5pt),
    ))
  }

  // Titelblock
  place(top + left, dx: 25mm, dy: 92mm, block(width: 150mm, {
    td-small-caps(cfg.doctype, fill: a, size: 8.5pt, tracking: 0.14em)
    v(6mm)
    set par(justify: false, leading: 0.32em)
    text(size: 31pt, weight: "bold", fill: td-ink, tracking: -0.015em, cfg.title)
    if cfg.subtitle != none {
      v(5mm)
      set par(leading: 0.5em)
      text(size: 14pt, fill: td-muted, cfg.subtitle)
    }
    v(9mm)
    rect(width: 22mm, height: 2.4pt, fill: a)
  }))

  // Metadaten unten
  place(top + left, dx: 25mm, dy: 232mm, block(width: 135mm, {
    line(length: 100%, stroke: 0.6pt + td-border)
    v(6mm)
    td-meta-grid(cfg)
  }))
})

/// Inhaltsverzeichnis mit Punktführern.
#let td-toc(cfg) = {
  show outline.entry.where(level: 1): it => {
    v(9pt, weak: true)
    link(it.element.location(), text(weight: "semibold", fill: td-ink, it.indented(
      text(fill: cfg.accent, it.prefix()),
      [#it.body() #h(1fr) #it.page()],
    )))
  }
  show outline.entry.where(level: 2): set text(fill: td-text)
  show outline.entry.where(level: 3): set text(size: 0.95em, fill: td-muted)
  set outline.entry(fill: box(width: 1fr, inset: (x: 3pt), repeat(text(fill: td-border.darken(25%), "."), gap: 3pt)))
  outline(title: cfg.labels.toc, depth: 3, indent: auto)
  pagebreak(weak: true)
}

/// Kopf- und Fußzeile.
#let td-header(cfg) = context {
  let start = query(<ts-body-start>)
  let page-no = here().page()
  let in-body = start.len() > 0 and page-no >= start.first().location().page()
  let opens-chapter = query(heading.where(level: 1)).any(h => h.location().page() == page-no)
  if in-body and not opens-chapter {
    let before = query(heading.where(level: 1).before(here()))
    let chapter = if before.len() > 0 {
      let hd = before.last()
      if hd.numbering != none {
        let n = counter(heading).at(hd.location()).first()
        [#n #h(0.4em) #hd.body]
      } else { hd.body }
    }
    set text(size: 7.8pt, fill: td-muted)
    block(width: 100%, inset: (bottom: 5pt), stroke: (bottom: 0.5pt + td-border), grid(
      columns: (1fr, auto),
      align: (left + bottom, right + bottom),
      {
        if cfg.logo != none { box(height: 8pt, baseline: 1pt, image(cfg.logo, height: 8pt)); h(5pt) }
        text(weight: "medium", fill: td-text, cfg.title)
      },
      chapter,
    ))
  }
}

#let td-footer(cfg) = context {
  let start = query(<ts-body-start>)
  let in-body = start.len() > 0 and here().page() >= start.first().location().page()
  if in-body {
    set text(size: 7.8pt, fill: td-muted)
    let parts = (cfg.organization, cfg.classification, cfg.footer-note).filter(x => x != none)
    grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      parts.map(x => [#x]).join([ #h(0.35em) · #h(0.35em) ]),
      [#cfg.labels.page #h(0.25em) #text(fill: td-text, weight: "medium", counter(page).display("1")) #h(0.2em) / #h(0.2em) #counter(page).final().first()],
    )
  }
}

/// Grundlayout: Seiten, Überschriften, Abbildungen. `cover-fn` erzeugt die
/// Titelseite (oder `none`).
#let td-layout(cfg, cover-fn: td-cover, chapter-style: "number", body) = {
  let a = cfg.accent
  set document(title: cfg.title, author: cfg.authors)
  set text(lang: cfg.lang, font: ("Inter", "Libertinus Serif"), size: 10pt, fill: td-text)
  ts-set-theme(accent: a, accent-soft: a.lighten(92%), size: 10pt)

  set page(
    paper: cfg.paper,
    margin: (top: 27mm, bottom: 24mm, left: 24mm, right: 22mm),
    header-ascent: 35%,
    footer-descent: 35%,
    header: td-header(cfg),
    footer: td-footer(cfg),
  )

  show: ts-base-style

  // Typografie
  set par(justify: false, leading: 0.74em, spacing: 1.2em, linebreaks: "optimized")
  set text(hyphenate: false, costs: (widow: 100%, orphan: 100%))
  show strong: set text(weight: "semibold", fill: td-ink)
  set list(indent: 0.2em, body-indent: 0.65em, spacing: 0.75em, marker: (text(fill: a, sym.bullet), text(fill: td-muted, [–]), text(fill: td-muted, sym.bullet)))
  set enum(indent: 0.1em, body-indent: 0.6em, spacing: 0.75em, numbering: n => text(fill: a, weight: "semibold", numbering("1.", n)))
  show link: it => if type(it.dest) == str {
    text(fill: a, it)
  } else {
    text(fill: a.darken(5%), it)
  }

  // Überschriften
  set heading(numbering: if cfg.numbering { "1.1" } else { none })
  show heading: set text(font: ("Inter",), fill: td-ink)
  show heading.where(level: 1): it => {
    if cfg.chapter-pagebreak { pagebreak(weak: true) }
    counter(figure.where(kind: image)).update(0)
    counter(figure.where(kind: table)).update(0)
    counter(figure.where(kind: raw)).update(0)
    block(width: 100%, above: 0pt, below: 10mm, breakable: false, {
      set par(justify: false, leading: 0.3em, spacing: 0pt)
      v(4mm)
      if it.numbering != none {
        if chapter-style == "eyebrow" {
          block(below: 4mm, td-small-caps([#cfg.labels.chapter #context counter(heading).display("1")], fill: a, size: 8.5pt, tracking: 0.12em))
        } else {
          block(below: 3mm, text(size: 36pt, weight: "light", fill: a, top-edge: "cap-height", bottom-edge: "baseline", context counter(heading).display("1")))
        }
      }
      block(below: 6mm, text(size: 23pt, weight: "bold", tracking: -0.01em, top-edge: "cap-height", it.body))
      line(length: 100%, stroke: 0.6pt + td-border)
    })
  }
  show heading.where(level: 2): it => block(width: 100%, above: 2.1em, below: 0.95em, sticky: true, {
    set text(size: 14pt, weight: "semibold")
    set par(justify: false)
    if it.numbering != none {
      box(width: auto, text(fill: a, context counter(heading).display(it.numbering)))
      h(0.65em)
    }
    it.body
  })
  show heading.where(level: 3): it => block(width: 100%, above: 1.8em, below: 0.8em, sticky: true, {
    set text(size: 11.5pt, weight: "semibold")
    if it.numbering != none {
      text(fill: td-muted, context counter(heading).display(it.numbering))
      h(0.6em)
    }
    it.body
  })
  show heading.where(level: 4): it => block(above: 1.5em, below: 0.7em, sticky: true, text(size: 10pt, weight: "semibold", it.body))
  show heading.where(level: 5): it => block(above: 1.4em, below: 0.6em, sticky: true, text(size: 10pt, weight: "semibold", fill: td-muted, it.body))

  // Jede Markdoc-Seite beginnt auf einer neuen Seite (Sprungziele bleiben korrekt).
  show metadata: it => {
    if cfg.chapter-pagebreak and type(it.value) == dictionary and it.value.at("kind", default: "") == "ts-page" {
      pagebreak(weak: true)
    }
    it
  }

  // Abbildungen kapitelweise nummerieren
  set figure(numbering: n => {
    let c = counter(heading).get()
    if cfg.numbering and c.len() > 0 and c.first() > 0 { numbering("1.1", c.first(), n) } else { numbering("1", n) }
  })
  set figure(gap: 0.9em)
  show figure.caption: it => {
    set text(size: 8.8pt, fill: td-muted)
    set par(justify: false)
    [#text(weight: "semibold", fill: td-text)[#it.supplement #context it.counter.display(it.numbering)]#it.separator#it.body]
  }
  show figure: set block(above: 1.6em, below: 1.6em)

  // Titelseite, Inhaltsverzeichnis, Inhalt
  if cfg.cover and cover-fn != none { cover-fn(cfg) }
  if cfg.toc { td-toc(cfg) }
  [#metadata("ts-body-start") <ts-body-start>]
  counter(page).update(1)
  body
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
  let cfg = td-config(title, subtitle, authors, version, date, lang, options)
  td-layout(cfg, body)
}
