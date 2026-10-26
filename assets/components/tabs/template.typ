#import "@sqritto/markdoc:0.1.0": ts-theme

#let ts-tabs(group: none, body) = context {
  let t = ts-theme.get()
  block(
    width: 100%,
    breakable: true,
    above: 1em,
    below: 1em,
    radius: t.radius,
    stroke: 0.6pt + t.border,
    clip: true,
    body,
  )
}
