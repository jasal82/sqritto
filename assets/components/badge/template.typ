#let ts-badge-colors = (
  gray: rgb("#64748b"),
  blue: rgb("#2563eb"),
  green: rgb("#16a34a"),
  yellow: rgb("#ca8a04"),
  orange: rgb("#ea580c"),
  red: rgb("#dc2626"),
  purple: rgb("#7c3aed"),
)

#let ts-badge(color: "gray", body) = {
  let c = ts-badge-colors.at(color, default: ts-badge-colors.gray)
  box(
    fill: c.lighten(87%),
    stroke: 0.4pt + c.lighten(55%),
    inset: (x: 4pt, y: 0pt),
    outset: (y: 2.2pt),
    radius: 3pt,
    text(size: 0.8em, weight: "medium", fill: c.darken(25%), body),
  )
}
