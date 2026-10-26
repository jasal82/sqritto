#import "@sqritto/markdoc:0.1.0": ts-theme

#let ts-step-counter = counter("ts-step")

#let ts-steps(body) = {
  ts-step-counter.update(0)
  block(width: 100%, above: 1.1em, below: 1.1em, body)
}
