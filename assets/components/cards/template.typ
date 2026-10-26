// Die Engine übergibt jede `card` als eigenes Positionsargument
// (siehe "collect" in component.json).
#let ts-cards(columns: 2, ..cards) = block(width: 100%, above: 1.1em, below: 1.1em, grid(
  columns: (1fr,) * calc.clamp(int(columns), 1, 4),
  column-gutter: 10pt,
  row-gutter: 10pt,
  ..cards.pos(),
))
