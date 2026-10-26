// Invoice – enter the line items, totals are calculated automatically.
#import "@sqritto/rechnung:0.1.0": rechnung

#show: rechnung.with(
  sprache: "en",
  absender: (
    name: "{{author}}",
    zusatz: "Information Architecture Consulting",
    strasse: "Lindenallee 12",
    ort: "10115 Berlin",
    telefon: "+49 30 1234567",
    email: "billing@example.com",
    web: "www.example.com",
    ustid: "DE123456789",
  ),
  empfaenger: [
    Harbor Logistics AG \
    IT Architecture \
    Hafenstraße 8 \
    20457 Hamburg
  ],
  nummer: "{{year}}-0142",
  kundennummer: "C-1042",
  bestellnummer: "4500012345",
  leistungszeitraum: "October {{year}}",
  positionen: (
    (beschreibung: [*Review* of the documentation], detail: "Interviews, analysis of storage locations", menge: 2, einheit: "days", preis: 1150),
    (beschreibung: [*Pilot project* arc42 architecture documentation], detail: "Templates, migration, review", menge: 5, einheit: "days", preis: 1150),
    (beschreibung: [*Training* docs as code], detail: "up to 12 participants, including materials", menge: 1, einheit: "day", preis: 1350),
    (beschreibung: [Book “Docs as Code in Practice”], menge: 3, einheit: "pcs.", preis: 39.9, ust: 7),
  ),
  ust: 19,
  zahlungsziel: 14,
  bank: (institut: "Example Bank Berlin", iban: "DE12 1001 0010 0123 4567 89", bic: "PBNKDEFFXXX"),
)

Thank you for the pleasant collaboration!
