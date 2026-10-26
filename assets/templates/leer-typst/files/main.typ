// {{title}}
#set document(title: "{{title}}", author: "{{author}}")
#set page(
  paper: "a4",
  margin: (x: 24mm, top: 26mm, bottom: 24mm),
  numbering: "1",
  number-align: center,
)
#set text(font: "Inter", size: 10.5pt, lang: "{{lang}}", fill: rgb("#1e293b"))
#set par(justify: true, leading: 0.72em, spacing: 1.2em)
#set heading(numbering: "1.1")
#show heading: set text(fill: rgb("#0f172a"))
#show heading: set block(above: 1.6em, below: 0.9em)
#show raw: set text(font: "JetBrains Mono", size: 1.08em)
#show link: set text(fill: rgb("#2563eb"))

#block(below: 2em, {
  set par(spacing: 0.7em)
  text(size: 24pt, weight: "bold", "{{title}}")
  parbreak()
  text(fill: rgb("#64748b"), "{{author}} · {{date}}")
})

= Einleitung

Hier beginnt Ihr Dokument. Typst-Syntax im Überblick: *fett*, _kursiv_, `Code`, Formeln wie $a^2 + b^2 = c^2$ und Verweise auf @abschnitt.

== Ein Abschnitt <abschnitt>

- Aufzählung
- mit Punkten

+ Nummerierte
+ Liste
