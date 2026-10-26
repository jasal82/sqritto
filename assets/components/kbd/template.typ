#import "@sqritto/markdoc:0.1.0": ts-theme

#let ts-kbd(keys: "") = context {
  let t = ts-theme.get()
  let parts = keys.split("+").map(k => k.trim()).filter(k => k != "")
  let key(k) = box(
    fill: t.surface,
    stroke: (paint: t.border.darken(10%), thickness: 0.6pt),
    inset: (x: 3.5pt, y: 0pt),
    outset: (y: 2.5pt),
    radius: 2.5pt,
    text(font: t.mono, size: 0.8em, fill: t.ink, k),
  )
  parts.map(key).join(text(fill: t.muted, size: 0.8em, " + "))
}
