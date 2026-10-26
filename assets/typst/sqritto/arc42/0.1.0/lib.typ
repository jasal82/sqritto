// @sqritto/arc42 – Layout für Architekturdokumentation nach arc42.
//
// Gleicher Vertrag wie @sqritto/techdoc:
//   #show: ts-document.with(title: .., subtitle: .., authors: (..), version: ..,
//                           date: .., lang: "de", ..optionen)
//
// Unterstützte Optionen: toc, numbering, cover, accent (#4f46e5), logo, paper,
// organization, classification/confidential, doctype, chapter-pagebreak,
// system (Name des beschriebenen Systems, erscheint auf der Titelseite),
// status (z. B. „Entwurf“, „Freigegeben“).

#import "@sqritto/techdoc:0.1.0": *

#let a42-ink = rgb("#0b1220")

#let a42-cover(cfg) = page(margin: 0pt, header: none, footer: none, numbering: none, {
  let a = cfg.accent
  let L = cfg.labels
  // Dunkle Kopffläche
  place(top + left, rect(width: 100%, height: 158mm, fill: a42-ink))
  // Rasterpunkte als Dekor
  place(top + left, dx: 128mm, dy: 18mm, grid(
    columns: (6mm,) * 11,
    rows: (6mm,) * 9,
    ..range(99).map(i => align(center + horizon, circle(radius: 0.55pt, fill: white.transparentize(if calc.rem(i, 7) == 0 { 40% } else { 82% })))),
  ))
  // Akzentkante
  place(top + left, dy: 158mm, rect(width: 100%, height: 2.2mm, fill: a))
  // Bausteine-Symbol (drei gestapelte Blöcke)
  place(top + left, dx: 25mm, dy: 26mm, {
    let blk(w, c) = rect(width: w, height: 3.2mm, radius: 1pt, fill: c)
    stack(spacing: 1.3mm, blk(14mm, a), blk(10mm, a.lighten(35%)), blk(18mm, white.transparentize(30%)))
  })
  if cfg.logo != none {
    place(top + right, dx: -22mm, dy: 22mm, box(height: 12mm, image(cfg.logo, height: 12mm)))
  }
  place(top + left, dx: 25mm, dy: 74mm, block(width: 158mm, {
    set par(justify: false, leading: 0.32em, spacing: 0pt)
    text(size: 8.5pt, weight: "semibold", tracking: 0.16em, fill: a.lighten(45%), upper(cfg.doctype))
    v(7mm)
    text(size: 32pt, weight: "bold", fill: white, tracking: -0.015em, cfg.title)
    if cfg.subtitle != none {
      v(6mm)
      set par(leading: 0.5em)
      text(size: 13.5pt, fill: white.transparentize(28%), cfg.subtitle)
    }
  }))
  let status = cfg.options.at("status", default: none)
  if status != none or cfg.classification != none {
    place(top + left, dx: 25mm, dy: 140mm, {
      for s in (status, cfg.classification).filter(x => x != none) {
        box(inset: (x: 6pt, y: 3.5pt), radius: 3pt, stroke: 0.7pt + white.transparentize(55%),
          text(size: 7.5pt, weight: "semibold", tracking: 0.08em, fill: white, upper(s)))
        h(2mm)
      }
    })
  }
  // Untere Hälfte: Metadaten
  place(top + left, dx: 25mm, dy: 182mm, block(width: 160mm, {
    let system = cfg.options.at("system", default: none)
    if system != none {
      td-small-caps(if cfg.lang == "de" { "System" } else { "System" }, fill: a)
      v(1.5mm)
      text(size: 15pt, weight: "semibold", fill: a42-ink, system)
      v(10mm)
    }
    td-meta-grid(cfg, columns: 4, with-organization: true)
  }))
  place(bottom + left, dx: 25mm, dy: -18mm, text(size: 7.5pt, fill: td-muted, if cfg.lang == "de" [
    Gliederung nach arc42 (#link("https://arc42.org")[arc42.org]) – Template von Dr. Peter Hruschka, Dr. Gernot Starke und Mitwirkenden.
  ] else [
    Structured according to arc42 (#link("https://arc42.org")[arc42.org]) – template by Dr. Peter Hruschka, Dr. Gernot Starke and contributors.
  ]))
})

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
  let cfg = td-config(title, subtitle, authors, version, date, lang, options, doctype: if lang == "de" { "Architekturdokumentation" } else { "Architecture Documentation" })
  if options.named().at("accent", default: none) == none { cfg.accent = rgb("#4f46e5") }
  if cfg.footer-note == none { cfg.footer-note = if lang == "de" { "Gliederung nach arc42" } else { "Structured according to arc42" } }
  td-layout(cfg, cover-fn: a42-cover, chapter-style: "eyebrow", body)
}
