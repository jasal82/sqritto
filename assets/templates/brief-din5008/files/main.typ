// Geschäftsbrief nach DIN 5008 (Form B).
// Passen Sie Absender, Empfänger und Text an. Für Form A: form: "A".
#import "@sqritto/brief:0.1.0": brief, unterschrift, anlagen

#show: brief.with(
  absender: (
    name: "{{author}}",
    zusatz: "Beratung für Informationsarchitektur",
    strasse: "Lindenallee 12",
    ort: "10115 Berlin",
    telefon: "+49 30 1234567",
    email: "kontakt@example.de",
    web: "www.example.de",
  ),
  empfaenger: [
    Muster Logistik AG \
    Frau Dr. Erika Beispiel \
    Hafenstraße 8 \
    20457 Hamburg
  ],
  info: (
    ("Ihr Zeichen", "EB/2026-114"),
    ("Ihre Nachricht", "14.10.2026"),
    ("Unser Zeichen", "IA-0425"),
    ("Telefon", "+49 30 1234567"),
    ("Datum", "{{date}}"),
  ),
  betreff: [Angebot zur Einführung von Docs as Code],
  form: "B",
  fusszeile: (
    [#text(weight: "semibold", "{{author}}") \ Lindenallee 12 \ 10115 Berlin],
    [Telefon +49 30 1234567 \ kontakt\@example.de \ www.example.de],
    [Musterbank Berlin \ IBAN DE12 1001 0010 0123 4567 89 \ BIC PBNKDEFFXXX],
    [USt-IdNr. DE123456789 \ Steuernummer 27/123/45678],
  ),
)

Sehr geehrte Frau Dr. Beispiel,

vielen Dank für Ihre Anfrage und das freundliche Gespräch am 14. Oktober. Gern unterbreite ich Ihnen ein Angebot für die Einführung von Docs as Code in Ihrer IT-Abteilung.

Ziel ist, Ihre Architektur- und Betriebsdokumentation künftig gemeinsam mit dem Quellcode zu pflegen und bei jeder Änderung automatisch als PDF und durchsuchbare Webseite zu veröffentlichen. Dazu schlage ich drei Schritte vor:

+ *Bestandsaufnahme* der vorhandenen Dokumente und Ablagen (2 Tage)
+ *Pilotprojekt* mit der Architekturdokumentation von FlottenPilot nach arc42 (5 Tage)
+ *Schulung* des Teams und Übergabe der Vorlagen (1 Tag)

Den Aufwand beziffere ich auf acht Beratertage zu je 1.150 € zuzüglich Umsatzsteuer. Das ausführliche Angebot mit Zeitplan liegt diesem Schreiben bei.

Für Rückfragen stehe ich Ihnen jederzeit gern zur Verfügung. Ich freue mich auf die Zusammenarbeit.

#unterschrift("{{author}}", funktion: "Beratung für Informationsarchitektur")

#anlagen[Angebot Nr. IA-0425 (3 Seiten)][Referenzprojekte]
