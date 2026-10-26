// Business letter following DIN 5008 (form B) – fits window envelopes.
// Adjust sender, recipient and text. For form A use form: "A".
#import "@sqritto/brief:0.1.0": brief, unterschrift, anlagen

#show: brief.with(
  sprache: "en",
  absender: (
    name: "{{author}}",
    zusatz: "Information Architecture Consulting",
    strasse: "Lindenallee 12",
    ort: "10115 Berlin",
    telefon: "+49 30 1234567",
    email: "hello@example.com",
    web: "www.example.com",
  ),
  empfaenger: [
    Harbor Logistics AG \
    Dr. Erika Example \
    Hafenstraße 8 \
    20457 Hamburg
  ],
  info: (
    ("Your ref.", "EE/2026-114"),
    ("Your message", "October 14, 2026"),
    ("Our ref.", "IA-0425"),
    ("Phone", "+49 30 1234567"),
    ("Date", "{{date}}"),
  ),
  betreff: [Proposal: introducing docs as code],
  form: "B",
  fusszeile: (
    [#text(weight: "semibold", "{{author}}") \ Lindenallee 12 \ 10115 Berlin],
    [Phone +49 30 1234567 \ hello\@example.com \ www.example.com],
    [Example Bank Berlin \ IBAN DE12 1001 0010 0123 4567 89 \ BIC PBNKDEFFXXX],
    [VAT ID DE123456789],
  ),
)

Dear Dr. Example,

Thank you for your enquiry and for our pleasant conversation on October 14. I am happy to send you a proposal for introducing docs as code in your IT department.

The goal is to maintain your architecture and operations documentation alongside the source code and to publish it automatically as a PDF and a searchable website whenever it changes. I suggest three steps:

+ *Review* of the existing documents and storage locations (2 days)
+ *Pilot project* with the arc42 architecture documentation of FleetPilot (5 days)
+ *Training* for the team and hand-over of the templates (1 day)

I estimate the effort at eight consulting days at €1,150 each, plus VAT. The detailed proposal including a schedule is enclosed.

Please do not hesitate to contact me if you have any questions. I look forward to working with you.

#unterschrift("{{author}}", funktion: "Information Architecture Consulting")

#anlagen[Proposal no. IA-0425 (3 pages)][Reference projects]
