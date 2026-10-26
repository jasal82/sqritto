#import "@sqritto/markdoc:0.1.0": ts-theme

#let ts-tab(label: "", body) = context {
  let t = ts-theme.get()
  block(width: 100%, breakable: true, above: 0pt, below: 0pt, {
    block(
      width: 100%,
      fill: t.surface,
      inset: (x: 11pt, y: 6pt),
      below: 0pt,
      stroke: (bottom: 0.6pt + t.border, top: 0.6pt + t.border),
      text(size: 0.85em, weight: "semibold", fill: t.accent, label),
    )
    block(width: 100%, inset: (x: 11pt, top: 8pt, bottom: 10pt), above: 0pt, body)
  })
}
