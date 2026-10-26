#import "@sqritto/markdoc:0.1.0": ts-theme

#let ts-endpoint-colors = (
  GET: rgb("#2563eb"),
  POST: rgb("#16a34a"),
  PUT: rgb("#ca8a04"),
  PATCH: rgb("#9333ea"),
  DELETE: rgb("#dc2626"),
  HEAD: rgb("#64748b"),
  OPTIONS: rgb("#64748b"),
)

#let ts-endpoint(method: "GET", path: "", body) = context {
  let t = ts-theme.get()
  let c = ts-endpoint-colors.at(method, default: t.accent)
  let has-body = body != [] and body != none
  block(width: 100%, breakable: true, above: 1.1em, below: 1.1em, radius: t.radius, stroke: 0.6pt + t.border, clip: true, {
    block(width: 100%, fill: t.surface, inset: (x: 10pt, y: 7pt), below: 0pt,
      stroke: if has-body { (bottom: 0.6pt + t.border) } else { none }, {
      box(fill: c, inset: (x: 5pt, y: 2pt), outset: (y: 1pt), radius: 3pt,
        text(font: t.mono, size: 0.75em, weight: "bold", fill: white, method))
      h(0.6em)
      text(font: t.mono, size: 0.88em, fill: t.ink, path)
    })
    if has-body { block(width: 100%, inset: (x: 11pt, top: 8pt, bottom: 10pt), above: 0pt, body) }
  })
}
