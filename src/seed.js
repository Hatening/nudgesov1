const stamp = () => new Date().toISOString();

export const seedKnowledge = [
  { id:'kb_demo_shipping', title:'Shipping and delivery', type:'faq', language:'en', tags:['shipping','delivery','tracking'], content:'Orders are normally processed within 1–2 business days. Standard delivery usually takes 5–8 business days after dispatch. Tracking is sent by email when the parcel ships. International customs can add delays. If tracking has not updated for 5 business days, contact support with the order number.' },
  { id:'kb_demo_returns', title:'Returns and refunds', type:'policy', language:'en', tags:['return','refund','exchange'], content:'Customers may request a return within 30 days after delivery if the item is unused and in original packaging. Final-sale items are not returnable unless faulty. Refunds are initiated after the returned item is inspected and usually appear within 5–10 business days. Do not promise a refund before eligibility is checked.' },
  { id:'kb_demo_warranty', title:'Warranty', type:'faq', language:'en', tags:['warranty','fault','repair'], content:'Eligible products include a 12-month limited warranty against manufacturing defects. Accidental damage and normal wear are excluded. Ask the customer for the order number, product model, and a photo or description of the issue before confirming eligibility.' }
];

export const seedGlossary = [
  { id:'glossary_sku', source:'SKU', preferred:{en:'SKU',es:'SKU',fr:'SKU',de:'SKU',zh:'库存单位'}, forbidden:[], notes:'Keep the SKU unchanged in all languages.' },
  { id:'glossary_refund', source:'refund', preferred:{en:'refund',es:'reembolso',fr:'remboursement',de:'Rückerstattung',zh:'退款'}, forbidden:[], notes:'Use the approved commerce term; do not imply approval before policy checks.' },
  { id:'glossary_order', source:'order number', preferred:{en:'order number',es:'número de pedido',fr:'numéro de commande',de:'Bestellnummer',zh:'订单号'}, forbidden:[], notes:'Ask for this when investigating an order.' }
];

export const seedConversations = [
  { id:'conv_1001', customer:'Maya R.', channel:'Website', language:'en', intent:'Shipping status', status:'open', lastMessage:'My tracking has not updated in a few days. Can you check?', messages:[{role:'customer',text:'My tracking has not updated in a few days. Can you check?'}] },
  { id:'conv_1002', customer:'Carlos G.', channel:'Email', language:'es', intent:'Return policy', status:'open', lastMessage:'¿Puedo devolver un producto sin abrir?', messages:[{role:'customer',text:'¿Puedo devolver un producto sin abrir?'}] },
  { id:'conv_1003', customer:'Aisha K.', channel:'Website', language:'ar', intent:'Product warranty', status:'pending', lastMessage:'هل يوجد ضمان على هذا المنتج؟', messages:[{role:'customer',text:'هل يوجد ضمان على هذا المنتج؟'}] }
];

export const seedSettings = {
  storeName:'Northstar Goods',
  defaultLanguage:'en',
  supportedLanguages:['en','es','fr','de','pt','it','zh','ja','ko','ar','hi','nl','sv','no'],
  confidenceThreshold:0.62,
  requireEvidence:true,
  humanHandoff:true,
  ollamaEnabled:false,
  freeMonthlyReplies:200,
  privacyRetentionDays:365,
  adsEnabled:true,
  adDisclosure:'Sponsored industry updates help support the free plan. Ads are labeled and do not affect AI answers.'
};

export const seedData = {
  knowledge: seedKnowledge,
  glossary: seedGlossary,
  conversations: seedConversations,
  settings: seedSettings,
  events: [],
  testRuns: [],
  users: [],
  tenants: [],
  sites: [],
  sessions: [],
  publicMessages: [],
  escalations: []
};

export function seedDatabase(db) {
  const at = stamp();
  const insertKnowledge = db.prepare(`INSERT OR IGNORE INTO knowledge
    (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content, status, created_at, updated_at)
    VALUES (?, NULL, NULL, 'global', NULL, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`);
  for (const item of seedKnowledge) {
    insertKnowledge.run(item.id, item.title, item.type || 'article', item.language || 'en', JSON.stringify(item.tags || []), item.content, at, at);
  }

  const insertGlossary = db.prepare(`INSERT OR IGNORE INTO glossary
    (id, source, preferred_json, forbidden_json, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const item of seedGlossary) {
    insertGlossary.run(item.id, item.source, JSON.stringify(item.preferred || {}), JSON.stringify(item.forbidden || []), item.notes || '', at, at);
  }

  const insertConversation = db.prepare(`INSERT OR IGNORE INTO conversations
    (id, tenant_id, customer, channel, language, intent, status, last_message, created_at, updated_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertMessage = db.prepare(`INSERT OR IGNORE INTO messages
    (id, tenant_id, site_id, conversation_id, embed_key, source, role, input_type, message, language, created_at)
    VALUES (?, NULL, NULL, ?, NULL, 'legacy', ?, 'text', ?, ?, ?)`);
  for (const conversation of seedConversations) {
    insertConversation.run(conversation.id, conversation.customer, conversation.channel, conversation.language, conversation.intent, conversation.status, conversation.lastMessage, at, at);
    conversation.messages.forEach((message, index) => {
      insertMessage.run(`msg_seed_${conversation.id}_${index}`, conversation.id, message.role, message.text, conversation.language, at);
    });
  }

  db.prepare(`INSERT OR IGNORE INTO settings (key, value_json) VALUES ('app', ?)`).run(JSON.stringify(seedSettings));
}
