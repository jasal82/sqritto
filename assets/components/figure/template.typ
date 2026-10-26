#import "@sqritto/markdoc:0.1.0": ts-length

#let ts-figure-block(src: none, caption: none, alt: none, width: none) = {
  let img = image(src, alt: alt, width: ts-length(width, default: auto))
  if caption != none and caption != "" {
    figure(img, caption: caption)
  } else {
    block(width: 100%, align(center, img))
  }
}
