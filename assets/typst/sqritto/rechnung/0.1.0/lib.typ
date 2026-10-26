// @sqritto/rechnung – Rechnung im DIN-5008-Layout.
//
//   #import "@sqritto/rechnung:0.1.0": rechnung
//   #show: rechnung.with(
//     absender: (name: "…", strasse: "…", ort: "…", telefon: none, email: none,
//                web: none, ustid: none, steuernummer: none),
//     empfaenger: [Firma \ Name \ Straße \ PLZ Ort],
//     nummer: "2026-001",
//     datum: auto,                 // auto = heute, oder datetime(year: …, month: …, day: …)
//     leistungszeitraum: "Oktober 2026",
//     kundennummer: none,
//     positionen: (
//       (beschreibung: "Leistung", menge: 2, einheit: "Std.", preis: 95),
//       (beschreibung: "Material", menge: 1, einheit: "Stk.", preis: 40, ust: 7),
//     ),
//     ust: 19,                      // Standardsteuersatz in Prozent
//     zahlungsziel: 14,             // Tage
//     bank: (inhaber: "…", iban: "…", bic: "…", institut: "…"),
//     kleinunternehmer: false,      // § 19 UStG
//     sprache: "de",                // "de" oder "en": Beschriftungen, Zahlen- und Datumsformat
//   )
//   Optionaler Text nach den Summen (Dank, Hinweise …)

#import "@sqritto/brief:0.1.0": brief

#let _grau = rgb("#64748b")
#let _tinte = rgb("#0f172a")
#let _linie = rgb("#e2e8f0")

/// Beschriftungen: Deutsch für "de", jede andere Sprache Englisch.
#let rechnung-texte = (
  de: (
    titel: "Rechnung",
    nummer: "Rechnungs-Nr.",
    datum: "Datum",
    kunde: "Kunden-Nr.",
    bestellung: "Ihre Bestellung",
    leistung: "Leistung",
    ustid: "USt-IdNr.",
    steuernummer: "Steuernummer",
    einleitung: [Sehr geehrte Damen und Herren,

    für die erbrachten Leistungen erlauben wir uns, Ihnen folgende Beträge in Rechnung zu stellen:],
    pos: "Pos.",
    beschreibung: "Beschreibung",
    menge: "Menge",
    einzelpreis: "Einzelpreis",
    ust: "USt.",
    gesamt: "Gesamt",
    netto: "Nettobetrag",
    zzgl: (satz) => [zzgl. #satz % USt.],
    auf: "auf",
    brutto: "Rechnungsbetrag",
    kleinunternehmer: [Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.],
    zahlung-bis: (summe, faellig, nummer) => [Bitte überweisen Sie den Rechnungsbetrag von *#summe* bis zum *#faellig* unter Angabe der Rechnungsnummer #nummer auf das unten genannte Konto.],
    zahlung-tage: (tage, nummer) => [Bitte überweisen Sie den Rechnungsbetrag innerhalb von #tage Tagen unter Angabe der Rechnungsnummer #nummer.],
  ),
  en: (
    titel: "Invoice",
    nummer: "Invoice no.",
    datum: "Date",
    kunde: "Customer no.",
    bestellung: "Your order",
    leistung: "Service period",
    ustid: "VAT ID",
    steuernummer: "Tax no.",
    einleitung: [Dear Sir or Madam,

    please find below our invoice for the services provided:],
    pos: "No.",
    beschreibung: "Description",
    menge: "Qty",
    einzelpreis: "Unit price",
    ust: "VAT",
    gesamt: "Total",
    netto: "Net amount",
    zzgl: (satz) => [plus #satz % VAT],
    auf: "on",
    brutto: "Amount due",
    kleinunternehmer: [No VAT is charged under § 19 UStG (small business exemption).],
    zahlung-bis: (summe, faellig, nummer) => [Please transfer the amount of *#summe* by *#faellig* to the account below, quoting invoice number #nummer.],
    zahlung-tage: (tage, nummer) => [Please transfer the invoice amount within #tage days, quoting invoice number #nummer.],
  ),
)

#let _texte(sprache) = if sprache == "de" { rechnung-texte.de } else { rechnung-texte.en }

/// Ganzzahl mit Tausendertrennzeichen (Deutsch „.“, Englisch „,“).
#let _gruppen(n, sprache: "de") = {
  let s = str(n)
  let out = ""
  let len = s.len()
  let sep = if sprache == "de" { "." } else { "," }
  for (i, c) in s.clusters().enumerate() {
    if i > 0 and calc.rem(len - i, 3) == 0 { out += sep }
    out += c
  }
  out
}

/// Betrag im Format der Sprache, z. B. 1.234,56 € bzw. €1,234.56.
#let betrag(x, waehrung: "€", sprache: "de") = {
  let cents = int(calc.round(x * 100))
  let neg = cents < 0
  let c = calc.abs(cents)
  let rest = calc.rem(c, 100)
  let komma = if sprache == "de" { "," } else { "." }
  let s = _gruppen(calc.quo(c, 100), sprache: sprache) + komma + (if rest < 10 { "0" } else { "" }) + str(rest)
  let vz = if neg { "−" } else { "" }
  if waehrung == none or waehrung == "" { vz + s } else if sprache == "de" {
    vz + s + "\u{00A0}" + waehrung
  } else {
    // Englisch: Symbol vor dem Betrag (€1,234.56), Kürzel mit Abstand (EUR 1,234.56).
    vz + waehrung + (if waehrung.clusters().len() > 1 { "\u{00A0}" } else { "" }) + s
  }
}

/// Zahl mit Dezimalzeichen der Sprache (für Mengen).
#let zahl(x, sprache: "de") = {
  if type(x) == int { _gruppen(x, sprache: sprache) } else {
    let r = calc.round(x, digits: 3)
    if r == calc.floor(r) { _gruppen(int(r), sprache: sprache) } else if sprache == "de" { str(r).replace(".", ",") } else { str(r) }
  }
}

#let _runden(x) = calc.round(x * 100) / 100

#let rechnung(
  absender: (:),
  empfaenger: none,
  nummer: "",
  datum: auto,
  leistungszeitraum: none,
  kundennummer: none,
  bestellnummer: none,
  positionen: (),
  ust: 19,
  zahlungsziel: 14,
  bank: none,
  kleinunternehmer: false,
  einleitung: auto,
  waehrung: "€",
  titel: auto,
  form: "B",
  logo: none,
  akzent: rgb("#1d4ed8"),
  sprache: "de",
  body,
) = {
  let T = _texte(sprache)
  let titel = if titel == auto { T.titel } else { titel }
  let betrag = betrag.with(sprache: sprache)
  let zahl = zahl.with(sprache: sprache)
  let datumsformat = if sprache == "de" { "[day].[month].[year]" } else { "[month repr:long] [day padding:none], [year]" }
  let a = absender
  let heute = if datum == auto { datetime.today() } else { datum }
  let datum-text = if type(heute) == datetime { heute.display(datumsformat) } else { str(heute) }
  let faellig = if type(heute) == datetime and zahlungsziel != none {
    (heute + duration(days: zahlungsziel)).display(datumsformat)
  } else { none }

  // --- Berechnung ---
  let zeilen = positionen.enumerate().map(((i, p)) => {
    let menge = p.at("menge", default: 1)
    let preis = p.at("preis", default: 0)
    let satz = if kleinunternehmer { 0 } else { p.at("ust", default: ust) }
    (
      pos: i + 1,
      beschreibung: p.at("beschreibung", default: ""),
      detail: p.at("detail", default: none),
      menge: menge,
      einheit: p.at("einheit", default: ""),
      preis: preis,
      netto: _runden(menge * preis),
      satz: satz,
    )
  })
  let netto = zeilen.map(z => z.netto).sum(default: 0)
  let saetze = zeilen.map(z => z.satz).dedup().sorted()
  let steuern = saetze.filter(s => s > 0).map(s => {
    let basis = zeilen.filter(z => z.satz == s).map(z => z.netto).sum(default: 0)
    (satz: s, basis: basis, betrag: _runden(basis * s / 100))
  })
  let summe-ust = steuern.map(s => s.betrag).sum(default: 0)
  let brutto = _runden(netto + summe-ust)

  // --- Informationsblock und Fußzeile ---
  let info = ((T.nummer, strong(nummer)), (T.datum, datum-text))
  if kundennummer != none { info.push((T.kunde, kundennummer)) }
  if bestellnummer != none { info.push((T.bestellung, bestellnummer)) }
  if leistungszeitraum != none { info.push((T.leistung, leistungszeitraum)) }
  let steuer-ids = (
    if a.at("ustid", default: none) != none { [#T.ustid #a.ustid] },
    if a.at("steuernummer", default: none) != none { [#T.steuernummer #a.steuernummer] },
  ).filter(x => x != none)
  let kontakt = (a.at("telefon", default: none), a.at("email", default: none), a.at("web", default: none)).filter(x => x != none)
  let fuss = (
    [#text(weight: "semibold", a.at("name", default: "")) \ #a.at("strasse", default: "") \ #a.at("ort", default: "")],
    if kontakt.len() > 0 { kontakt.join(linebreak()) },
    if bank != none {
      (bank.at("institut", default: none), if bank.at("iban", default: none) != none [IBAN #bank.iban], if bank.at("bic", default: none) != none [BIC #bank.bic]).filter(x => x != none).join(linebreak())
    },
    if steuer-ids.len() > 0 { steuer-ids.join(linebreak()) },
  ).filter(x => x != none)

  show: brief.with(
    absender: a,
    empfaenger: empfaenger,
    info: info,
    datum: none,
    betreff: [#titel #nummer],
    form: form,
    logo: logo,
    akzent: akzent,
    fusszeile: fuss,
    sprache: sprache,
  )

  if einleitung == auto { T.einleitung } else if einleitung != none { einleitung }

  // --- Positionstabelle ---
  let kopf(t, al: left) = align(al, text(size: 7.5pt, weight: "semibold", fill: _grau, tracking: 0.04em, upper(t)))
  let mehrere-saetze = saetze.len() > 1
  block(width: 100%, above: 1.4em, below: 0.6em, {
    set par(spacing: 0pt, leading: 0.5em)
    table(
      columns: if mehrere-saetze { (auto, 1fr, auto, auto, auto, auto) } else { (auto, 1fr, auto, auto, auto) },
      align: (x, y) => if x == 1 { left } else if x == 0 { left } else { right },
      inset: (x: 5pt, y: 6pt),
      stroke: (x, y) => (bottom: if y == 0 { 0.8pt + _tinte } else { 0.4pt + _linie }),
      table.header(
        kopf(T.pos),
        kopf(T.beschreibung),
        kopf(T.menge, al: right),
        kopf(T.einzelpreis, al: right),
        ..(if mehrere-saetze { (kopf(T.ust, al: right),) } else { () }),
        kopf(T.gesamt, al: right),
      ),
      ..zeilen.map(z => (
        text(fill: _grau, str(z.pos)),
        {
          z.beschreibung
          if z.detail != none { linebreak(); text(size: 0.85em, fill: _grau, z.detail) }
        },
        [#zahl(z.menge) #z.einheit],
        betrag(z.preis, waehrung: waehrung),
        ..(if mehrere-saetze { ([#z.satz %],) } else { () }),
        betrag(z.netto, waehrung: waehrung),
      )).flatten(),
    )
  })

  // --- Summen ---
  align(right, block(width: 78mm, {
    set par(spacing: 0pt)
    let zeile(l, r, stark: false) = grid(
      columns: (1fr, auto),
      inset: (y: 4pt, x: 5pt),
      text(weight: if stark { "semibold" } else { "regular" }, l),
      text(weight: if stark { "semibold" } else { "regular" }, r),
    )
    zeile[#T.netto][#betrag(netto, waehrung: waehrung)]
    for s in steuern {
      zeile[#(T.zzgl)(s.satz) #if steuern.len() > 1 [#T.auf #betrag(s.basis, waehrung: waehrung)]][#betrag(s.betrag, waehrung: waehrung)]
    }
    line(length: 100%, stroke: 0.8pt + _tinte)
    block(fill: akzent.lighten(93%), width: 100%,
      zeile(stark: true)[#T.brutto][#text(fill: akzent.darken(10%), betrag(brutto, waehrung: waehrung))])
  }))

  v(1.2em)
  if kleinunternehmer {
    T.kleinunternehmer
    parbreak()
  }
  if zahlungsziel != none {
    if faellig != none {
      (T.zahlung-bis)(betrag(brutto, waehrung: waehrung), faellig, nummer)
    } else {
      (T.zahlung-tage)(zahlungsziel, nummer)
    }
  }
  body
}
