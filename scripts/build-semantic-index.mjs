import { openDatabase, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { buildSemanticIndex } from '../src/semantic-retrieval.js';

const db = openDatabase('.data/relaydesk.sqlite');
const dao = createDao(db);
const cards = dao.listGlobalKnowledge('all', { includeQuarantined: false });
closeDatabase(db);
console.log(`building semantic index for ${cards.length} cards...`);
const result = await buildSemanticIndex(cards, { force: process.argv.includes('--force') });
console.log(JSON.stringify({ cards: result.index.cards.length, dim: result.index.dim, cached: result.cached }));
