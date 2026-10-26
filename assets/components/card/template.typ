#import "@sqritto/markdoc:0.1.0": ts-theme

#let ts-card(title: "", href: none, body) = context {
  let t = ts-theme.get()
  let head = text(weight: "semibold", fill: t.ink, title)
  if href != none { head = link(href, head + h(0.3em) + text(fill: t.accent, sym.arrow.r)) }
  block(
    width: 100%,
    height: auto,
    inset: (x: 10pt, y: 9pt),
    radius: t.radius + 1pt,
    stroke: 0.6pt + t.border,
    breakable: false,
    {
      set par(justify: false)
      block(below: 0.5em, head)
      text(size: 0.92em, fill: t.muted, body)
    },
  )
}
