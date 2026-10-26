// @sqritto/brief – Geschäftsbrief nach DIN 5008.
//
//   #import "@sqritto/brief:0.1.0": brief, unterschrift, anlagen
//   #show: brief.with(
//     absender: (name: "…", zusatz: none, strasse: "…", ort: "…",
//                telefon: none, email: none, web: none),
//     empfaenger: [Firma \ Herr Max Mustermann \ Straße 1 \ 12345 Ort],
//     info: (("Ihr Zeichen", "…"), ("Unser Zeichen", "…")),
//     betreff: [Betreff],
//     form: "B",          // "A" oder "B"
//     sprache: "de",      // "de" oder "en" (Beschriftungen, Datum, Silbentrennung)
//   )
//
// Alle Maße folgen DIN 5008 (A4). Positionen sind vom Blattrand gemessen.

/// Beschriftungen: Deutsch für "de", jede andere Sprache Englisch.
#let brief-texte = (
  de: (datum: "Datum", seite: "Seite", von: "von", gruss: "Mit freundlichen Grüßen", anlagen: "Anlagen"),
  en: (datum: "Date", seite: "Page", von: "of", gruss: "Kind regards", anlagen: "Enclosures"),
)

#let _texte(sprache) = if sprache == "de" { brief-texte.de } else { brief-texte.en }

#let _today(sprache: "de") = if sprache == "de" {
  datetime.today().display("[day].[month].[year]")
} else {
  datetime.today().display("[month repr:long] [day padding:none], [year]")
}

/// Geometrie für Form A und Form B.
#let brief-geometrie(form) = if form == "A" {
  (
    kopf: 27mm,
    anschrift-y: 27mm,
    info-y: 32mm,
    falz: (87mm, 192mm),
    betreff-y: 80.46mm,
  )
} else {
  (
    kopf: 45mm,
    anschrift-y: 45mm,
    info-y: 50mm,
    falz: (105mm, 210mm),
    betreff-y: 98.46mm,
  )
}

#let _grau = rgb("#64748b")
#let _tinte = rgb("#0f172a")
#let _linie = rgb("#cbd5e1")

/// Grußformel mit Platz für die Unterschrift. Ohne `gruss` passend zur
/// Sprache des Briefs.
#let unterschrift(name, funktion: none, gruss: auto, firma: none) = {
  block(breakable: false, {
    set par(spacing: 0pt)
    if gruss == auto { context _texte(text.lang).gruss } else { gruss }
    if firma != none { linebreak(); firma }
    // Platz für die Unterschrift (drei Leerzeilen)
    v(3 * (1em + 0.62em) + 1em)
    name
    if funktion != none {
      linebreak()
      text(fill: _grau, funktion)
    }
  })
}

/// Anlagen- und Verteilervermerk.
#let anlagen(..eintraege, titel: auto) = {
  block(breakable: false, {
    set par(spacing: 0pt)
    text(weight: "semibold", if titel == auto { context _texte(text.lang).anlagen } else { titel })
    for e in eintraege.pos() { linebreak(); e }
  })
}

#let brief(
  absender: (:),
  empfaenger: none,
  ruecksendeangabe: auto,
  zusatzvermerk: none,
  info: (),
  betreff: none,
  datum: auto,
  form: "B",
  logo: none,
  kopf: auto,
  fusszeile: none,
  falzmarken: true,
  lochmarke: true,
  akzent: rgb("#1d4ed8"),
  schrift: ("Inter", "Libertinus Serif"),
  groesse: 10pt,
  sprache: "de",
  body,
) = {
  let g = brief-geometrie(form)
  let T = _texte(sprache)
  let a = absender
  let name = a.at("name", default: none)
  let datum = if datum == auto { _today(sprache: sprache) } else { datum }
  let info = if type(info) == dictionary { info.pairs() } else { info }
  let hat-datum = info.any(p => lower(str(p.at(0))) in ("datum", "date"))
  let info = if datum != none and not hat-datum { info + ((T.datum, datum),) } else { info }
  let rueck = if ruecksendeangabe == auto {
    (name, a.at("strasse", default: none), a.at("ort", default: none)).filter(x => x != none).join(" · ")
  } else { ruecksendeangabe }
  let hat-fuss = fusszeile != none and fusszeile != ()

  set document(title: if type(betreff) == str { betreff } else { none }, author: if name != none { (name,) } else { () })
  // Zeilenabstand 1-zeilig; Absätze durch genau eine Leerzeile getrennt.
  let zeile = 1em + 0.62em
  set text(font: schrift, size: groesse, lang: sprache, fill: _tinte, hyphenate: false)
  set par(justify: false, leading: 0.62em, spacing: zeile)
  set list(spacing: 0.62em)
  set enum(spacing: 0.62em)

  // ---- Briefkopf (nur erste Seite) ----
  let briefkopf = if kopf != auto { kopf } else {
    place(top + left, dx: 25mm, dy: if form == "A" { 9mm } else { 17mm }, block(width: 110mm, {
      set par(spacing: 0pt, leading: 0.4em)
      if name != none { text(size: if form == "A" { 14pt } else { 17pt }, weight: "semibold", tracking: -0.01em, name) }
      let zusatz = a.at("zusatz", default: none)
      if zusatz != none {
        v(1.8mm)
        text(size: 8.5pt, fill: _grau, zusatz)
      }
      v(2.6mm)
      rect(width: 12mm, height: 1.4pt, fill: akzent)
    }))
    let kontakt = (a.at("telefon", default: none), a.at("email", default: none), a.at("web", default: none)).filter(x => x != none)
    if kontakt.len() > 0 and form == "B" {
      place(top + right, dx: -20mm, dy: 17mm, align(right, block({
        set text(size: 8pt, fill: _grau)
        set par(spacing: 0pt, leading: 0.55em)
        let adresse = (a.at("strasse", default: none), a.at("ort", default: none)).filter(x => x != none)
        if logo != none {
          box(height: 14mm, { set image(height: 14mm); logo })
        } else {
          adresse.join(linebreak())
          if adresse.len() > 0 { linebreak() }
          kontakt.join(linebreak())
        }
      })))
    } else if logo != none {
      let hoehe = if form == "A" { 12mm } else { 16mm }
      place(top + right, dx: -20mm, dy: if form == "A" { 9mm } else { 15mm }, box(height: hoehe, { set image(height: hoehe); logo }))
    }
  }

  let marken = {
    let mark(y, l) = place(top + left, dx: 4mm, dy: y, line(length: l, stroke: 0.4pt + _linie.darken(15%)))
    if falzmarken { for y in g.falz { mark(y, 5mm) } }
    if lochmarke { mark(148.5mm, 7mm) }
  }

  // Anschriftfeld 85 × 45 mm, Innenabstand links 5 mm
  let anschriftfeld = place(top + left, dx: 20mm, dy: g.anschrift-y, block(width: 85mm, height: 45mm, {
    // Zusatz- und Vermerkzone (17,7 mm): Rücksendeangabe am unteren Rand
    place(top + left, dx: 5mm, block(width: 80mm, height: 17.7mm, {
      if zusatzvermerk != none {
        place(top + left, dy: 3mm, text(size: 7.5pt, fill: _grau, zusatzvermerk))
      }
      if rueck != none and rueck != "" {
        place(bottom + left, dy: -1.6mm, block(width: 80mm, {
          text(size: 6.5pt, fill: _grau, rueck)
          v(-2.4mm)
          line(length: 100%, stroke: 0.3pt + _linie)
        }))
      }
    }))
    // Anschriftzone (27,3 mm)
    place(top + left, dx: 5mm, dy: 17.7mm, block(width: 80mm, height: 27.3mm, {
      set par(leading: 0.52em, spacing: 0pt)
      set text(size: groesse)
      empfaenger
    }))
  }))

  // Informationsblock: links 125 mm, 75 mm breit
  let infoblock = place(top + left, dx: 125mm, dy: g.info-y, block(width: 65mm, {
    set par(leading: 0.45em, spacing: 0pt)
    grid(
      columns: (27mm, 1fr),
      row-gutter: 2.2mm,
      ..info.map(((k, v)) => (
        text(size: 7.5pt, fill: _grau, [#k:]),
        text(size: 8.5pt, v),
      )).flatten(),
    )
  }))

  let fuss = if hat-fuss {
    let spalten = if type(fusszeile) == array { fusszeile } else { (fusszeile,) }
    block(width: 100%, inset: (top: 2.5mm), stroke: (top: 0.4pt + _linie), {
      set text(size: 7pt, fill: _grau)
      set par(leading: 0.5em, spacing: 0pt)
      grid(columns: (auto,) * spalten.len(), column-gutter: 1fr, ..spalten)
    })
  }

  set page(
    paper: "a4",
    margin: (left: 25mm, right: 20mm, top: 27mm, bottom: if hat-fuss { 34mm } else { 22mm }),
    header-ascent: 30%,
    footer-descent: 20%,
    background: context if here().page() == 1 {
      briefkopf
      marken
      anschriftfeld
      infoblock
    },
    header: context if here().page() > 1 {
      set text(size: 7.5pt, fill: _grau)
      block(width: 100%, inset: (bottom: 4pt), stroke: (bottom: 0.4pt + _linie), grid(
        columns: (1fr, auto),
        if name != none { name } else { [] },
        if betreff != none { betreff } else { [] },
      ))
    },
    footer: context {
      let gesamt = counter(page).final().first()
      if gesamt > 1 {
        align(right, text(size: 7.5pt, fill: _grau)[#T.seite #counter(page).display() #T.von #gesamt])
        v(1.5mm)
      }
      fuss
    },
  )

  // Beginn des Brieftextes: Betreff
  v(g.betreff-y - 27mm)
  if betreff != none {
    // Zwei Leerzeilen zwischen Betreff und Anrede
    block(below: 2 * zeile + 0.62em, text(weight: "semibold", betreff))
  }
  body
}
