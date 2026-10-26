// Gemeinsame MiniSearch-Optionen für Indexaufbau (Engine) und Suche (Site).
// Beide Seiten müssen identische Term-Verarbeitung verwenden.

const STOP = new Set(
  (
    'der die das den dem des ein eine einer eines einem einen und oder aber ist sind war wird werden ' +
    'im in am an auf aus bei mit nach von vor zu zum zur für über unter um als auch es sie er wir ihr ' +
    'sich nicht nur noch so wie wenn dass da hier the a an and or of to is are was be in on at for with by'
  ).split(' '),
);

export function processTerm(term: string): string | null {
  const t = term
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (t.length < 2 && !/\d/.test(t)) return null;
  if (STOP.has(t)) return null;
  return t;
}

export const SEARCH_OPTIONS = {
  idField: 'id',
  fields: ['heading', 'pageTitle', 'text'],
  storeFields: ['page', 'anchor', 'pageTitle', 'heading', 'text'],
  processTerm,
  searchOptions: {
    boost: { heading: 3, pageTitle: 2 },
    prefix: true,
    fuzzy: 0.2,
    combineWith: 'AND',
  },
};
