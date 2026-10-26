// Rechnung – Positionen eintragen, Summen werden automatisch berechnet.
#import "@sqritto/rechnung:0.1.0": rechnung

#show: rechnung.with(
  absender: (
    name: "{{author}}",
    zusatz: "Beratung für Informationsarchitektur",
    strasse: "Lindenallee 12",
    ort: "10115 Berlin",
    telefon: "+49 30 1234567",
    email: "rechnung@example.de",
    web: "www.example.de",
    ustid: "DE123456789",
  ),
  empfaenger: [
    Muster Logistik AG \
    Abteilung IT-Architektur \
    Hafenstraße 8 \
    20457 Hamburg
  ],
  nummer: "{{year}}-0142",
  kundennummer: "K-1042",
  bestellnummer: "4500012345",
  leistungszeitraum: "Oktober {{year}}",
  positionen: (
    (beschreibung: [*Bestandsaufnahme* der Dokumentation], detail: "Interviews, Analyse der Ablagen", menge: 2, einheit: "Tage", preis: 1150),
    (beschreibung: [*Pilotprojekt* arc42-Architekturdokumentation], detail: "Vorlagen, Migration, Review", menge: 5, einheit: "Tage", preis: 1150),
    (beschreibung: [*Schulung* Docs as Code], detail: "bis 12 Teilnehmende, inkl. Unterlagen", menge: 1, einheit: "Tag", preis: 1350),
    (beschreibung: [Fachbuch „Docs as Code in der Praxis“], menge: 3, einheit: "Stk.", preis: 39.9, ust: 7),
  ),
  ust: 19,
  zahlungsziel: 14,
  bank: (institut: "Musterbank Berlin", iban: "DE12 1001 0010 0123 4567 89", bic: "PBNKDEFFXXX"),
)

Vielen Dank für die angenehme Zusammenarbeit!
