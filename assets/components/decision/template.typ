#import "@sqritto/markdoc:0.1.0": ts-theme, ts-i18n

#let ts-decision-status = (
  proposed: (color: rgb("#ca8a04")),
  accepted: (color: rgb("#16a34a")),
  rejected: (color: rgb("#dc2626")),
  deprecated: (color: rgb("#64748b")),
  superseded: (color: rgb("#7c3aed")),
)

// Beschriftungen nach Dokumentsprache (sonst Englisch).
#let ts-decision-labels = (
  de: (
    proposed: "Vorgeschlagen",
    accepted: "Angenommen",
    rejected: "Abgelehnt",
    deprecated: "Veraltet",
    superseded: "Ersetzt",
    decided: "Entschieden am",
  ),
  en: (
    proposed: "Proposed",
    accepted: "Accepted",
    rejected: "Rejected",
    deprecated: "Deprecated",
    superseded: "Superseded",
    decided: "Decided on",
  ),
)

#let ts-decision(id: none, title: "", status: "proposed", date: none, body) = context {
  let t = ts-theme.get()
  let s = ts-decision-status.at(status, default: ts-decision-status.proposed)
  let L = ts-i18n(ts-decision-labels)
  let label = L.at(status, default: L.proposed)
  block(
    width: 100%,
    breakable: true,
    above: 1.2em,
    below: 1.2em,
    radius: t.radius + 1pt,
    stroke: 0.6pt + t.border,
    clip: true,
    {
      block(width: 100%, fill: t.surface, inset: (x: 11pt, y: 8pt), below: 0pt, stroke: (bottom: 0.6pt + t.border), grid(
        columns: (auto, 1fr, auto),
        column-gutter: 8pt,
        align: horizon,
        if id != none { text(font: t.mono, size: 0.8em, fill: t.muted, id) },
        text(weight: "semibold", fill: t.ink, title),
        box(fill: s.color.lighten(85%), inset: (x: 5pt, y: 2pt), radius: 3pt,
          text(size: 0.75em, weight: "semibold", fill: s.color.darken(20%), label)),
      ))
      block(width: 100%, inset: (x: 11pt, top: 8pt, bottom: 10pt), above: 0pt, {
        if date != none { block(below: 0.6em, text(size: 0.85em, fill: t.muted)[#L.decided #date]) }
        body
      })
    },
  )
}
