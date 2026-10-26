# Lizenztexte für eingebettete Inhalte Dritter

Inhalte Dritter, die nicht über npm oder Cargo eingebunden, sondern direkt in den Quelltext
übernommen sind. Die Texte landen in `THIRD-PARTY-LICENSES.txt` der Programmpakete und in
`_static/LICENSES.txt` jedes HTML5-Exports.

| Datei | Inhalt | Verwendet in |
| --- | --- | --- |
| `Lucide-LICENSE.txt` | Icons von [Lucide](https://lucide.dev) (ISC, einzelne Icons aus Feather, MIT) | Seitenrahmen der HTML5-Ausgabe (`engine/src/shell.ts`, `site/src/`), Element „callout“ |
| `InspiredGitHub-LICENSE.txt` | Farbschema „InspiredGitHub“ (MIT) für Syntaxhervorhebung, hell | `src/highlight.rs` |
| `OneHalf-LICENSE.txt` | Farbschema „One Half Dark“ (MIT) für Syntaxhervorhebung, dunkel | `src/highlight.rs` |

Wer hier etwas ergänzt, nimmt die Datei auch in `site/build.mjs` (Export) und
`scripts/third-party-licenses.mjs` (Programmpakete) auf.
