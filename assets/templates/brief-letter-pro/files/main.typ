// Brief mit der Typst-Universe-Vorlage „letter-pro“ (DIN 5008).
// Dokumentation: https://typst.app/universe/package/letter-pro
// Das Paket wird beim ersten Übersetzen automatisch heruntergeladen.
#import "@preview/letter-pro:3.0.0": letter-simple

#set text(lang: "de")

#show: letter-simple.with(
  format: "DIN-5008-B",
  font: "Inter",
  sender: (
    name: "{{author}}",
    address: "Lindenallee 12, 10115 Berlin",
    extra: [
      Telefon: #link("tel:+49301234567")[+49 30 1234567]\
      E-Mail: #link("mailto:kontakt@example.de")[kontakt\@example.de]\
    ],
  ),
  annotations: [Einschreiben – Rückschein],
  recipient: [
    Stadtwerke Musterstadt GmbH\
    Kundenservice\
    Am Wasserturm 3\
    12345 Musterstadt
  ],
  reference-signs: (
    ([Kundennummer], [4711-0815]),
    ([Vertragskonto], [2100 4455]),
  ),
  date: "{{date}}",
  subject: "Kündigung des Stromliefervertrags",
)

Sehr geehrte Damen und Herren,

hiermit kündige ich den oben genannten Stromliefervertrag fristgerecht zum nächstmöglichen Zeitpunkt. Bitte bestätigen Sie mir die Kündigung sowie das genaue Vertragsende schriftlich.

Den Zählerstand teile ich Ihnen zum Vertragsende gesondert mit. Ein etwaiges Guthaben überweisen Sie bitte auf das Ihnen bekannte Konto.

Mit freundlichen Grüßen
#v(1.2cm)
#text("{{author}}")
