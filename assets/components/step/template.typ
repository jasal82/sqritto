#import "@sqritto/markdoc:0.1.0": ts-theme

#let ts-step(title: none, body) = {
  counter("ts-step").step()
  context {
    let t = ts-theme.get()
    let n = counter("ts-step").get().first()
    block(width: 100%, breakable: true, above: 0.9em, below: 0.9em, grid(
      columns: (1.7em, 1fr),
      column-gutter: 0.85em,
      circle(
        radius: 0.8em,
        fill: t.accent.lighten(88%),
        stroke: 0.6pt + t.accent.lighten(40%),
        inset: 0pt,
        align(center + horizon, text(size: 0.82em, weight: "bold", fill: t.accent, str(n))),
      ),
      {
        if title != none { block(above: 0.25em, below: 0.6em, text(weight: "semibold", fill: t.ink, title)) }
        body
      },
    ))
  }
}
