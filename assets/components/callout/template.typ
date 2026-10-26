#import "@sqritto/markdoc:0.1.0": ts-theme, ts-i18n

#let ts-callout-styles = (
  note: (color: rgb("#2563eb"), glyph: "i"),
  info: (color: rgb("#0891b2"), glyph: "i"),
  tip: (color: rgb("#059669"), glyph: "✓"),
  success: (color: rgb("#16a34a"), glyph: "✓"),
  important: (color: rgb("#7c3aed"), glyph: "!"),
  warning: (color: rgb("#d97706"), glyph: "!"),
  caution: (color: rgb("#ea580c"), glyph: "!"),
  danger: (color: rgb("#dc2626"), glyph: "×"),
)

// Überschriften ohne `title` folgen der Dokumentsprache (sonst Englisch).
#let ts-callout-labels = (
  de: (note: "Hinweis", info: "Info", tip: "Tipp", success: "Erfolg", important: "Wichtig", warning: "Warnung", caution: "Vorsicht", danger: "Gefahr"),
  en: (note: "Note", info: "Info", tip: "Tip", success: "Success", important: "Important", warning: "Warning", caution: "Caution", danger: "Danger"),
)

// Rundes Symbol, mittig auf die Großbuchstabenhöhe der Titelzeile gesetzt.
// Das Zeichen wird per `place` gesetzt, damit seine Grundlinie nicht die
// Grundlinie der Box bestimmt (sonst hängt der Kreis zu tief).
#let ts-callout-icon(color, glyph) = context {
  let d = 1.2em
  let cap = measure(text(weight: "semibold")[H]).height
  box(width: d, height: d, baseline: d / 2 - cap / 2, {
    circle(radius: d / 2, fill: color, stroke: none)
    place(center + horizon, text(fill: white, size: 0.62em, weight: "bold", glyph))
  })
}

#let ts-callout(type: "note", title: none, body) = {
  let s = ts-callout-styles.at(type, default: ts-callout-styles.note)
  let label = context {
    let l = ts-i18n(ts-callout-labels)
    l.at(type, default: l.note)
  }
  block(
    width: 100%,
    breakable: true,
    above: 1.1em,
    below: 1.1em,
    fill: s.color.lighten(93%),
    stroke: (left: 2.5pt + s.color),
    radius: (right: 4pt),
    inset: (left: 11pt, right: 12pt, top: 9pt, bottom: 10pt),
    {
      set par(justify: false)
      block(below: 0.6em, {
        ts-callout-icon(s.color, s.glyph)
        h(0.45em)
        text(weight: "semibold", fill: s.color.darken(25%), if title != none { title } else { label })
      })
      body
    },
  )
}
