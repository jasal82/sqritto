#import "@sqritto/markdoc:0.1.0": ts-theme

#let ts-details(title: "Details", open: false, body) = context {
  let t = ts-theme.get()
  block(
    width: 100%,
    breakable: true,
    above: 1em,
    below: 1em,
    radius: t.radius,
    stroke: 0.6pt + t.border,
    clip: true,
    {
      block(width: 100%, fill: t.surface, inset: (x: 11pt, y: 7pt), below: 0pt,
        text(weight: "semibold", fill: t.ink)[#text(fill: t.accent, size: 0.7em, baseline: -0.1em)[▼] #h(0.25em) #title])
      block(width: 100%, inset: (x: 11pt, top: 8pt, bottom: 10pt), above: 0pt, stroke: (top: 0.6pt + t.border), body)
    },
  )
}
