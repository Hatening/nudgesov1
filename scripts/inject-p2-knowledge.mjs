import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';

const target = process.argv[2];
const dbPath = path.resolve(process.env.DB_PATH || path.join(process.cwd(), '.data', 'relaydesk.sqlite'));

if (!target) {
  console.error('Usage: node scripts/inject-p2-knowledge.mjs <embed_key_or_site_id>');
  console.error('Example: node scripts/inject-p2-knowledge.mjs 6088e64af95d4856959a8275');
  process.exit(1);
}

const docs = [
  {
    key: 'logistics',
    filename: 'logistics.txt',
    title: '物流时效',
    content: '物流：标准快递通常需要 3-5 个工作日送达。',
    exists: (text) => /3\s*-\s*5|标准快递|工作日|物流|快递|shipping|delivery/i.test(text)
  },
  {
    key: 'hours',
    filename: 'hours.txt',
    title: '营业时间',
    content: '营业时间：每天 09:00 - 21:00 营业。',
    exists: (text) => /09:00|21:00|营业时间|hours/i.test(text)
  }
];

const db = openDatabase(dbPath);
try {
  migrateSchema(db);
  const dao = createDao(db);
  const site = dao.findSiteByEmbedKey(target) || dao.findSiteById(target);
  if (!site) {
    console.error(`Site not found for "${target}" in ${dbPath}`);
    process.exit(1);
  }

  console.log(`site=${site.name}`);
  console.log(`site_id=${site.id}`);
  console.log(`embed_key=${site.embed_key}`);

  const confirmed = dao.listConfirmedKnowledgeForSite(site.id);
  const report = [];
  for (const doc of docs) {
    const existing = confirmed.find((item) => doc.exists(`${item.title || ''} ${item.content || ''}`));
    if (existing) {
      console.log(`${doc.key}=already-present (${existing.title})`);
      report.push({ key: doc.key, status: 'already-present', title: existing.title });
      continue;
    }
    const draft = dao.createSiteKnowledge(site.id, site.tenant_id, {
      id: `kbdoc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      filename: doc.filename,
      title: doc.title,
      content: doc.content,
      status: 'draft'
    });
    const confirmedDoc = dao.confirmSiteKnowledge(site.id, draft.id);
    if (!confirmedDoc || confirmedDoc.status !== 'confirmed') {
      throw new Error(`${doc.key}: confirmation did not return status=confirmed`);
    }
    console.log(`${doc.key}=created+confirmed (${confirmedDoc.title})`);
    report.push({ key: doc.key, status: 'created+confirmed', title: confirmedDoc.title, document_id: confirmedDoc.id });
  }

  const finalCount = dao.listConfirmedKnowledgeForSite(site.id).length;
  console.log(`confirmed_knowledge_count=${finalCount}`);
  console.log(JSON.stringify({ site: site.name, embed_key: site.embed_key, operations: report }, null, 2));
} finally {
  closeDatabase(db);
}
