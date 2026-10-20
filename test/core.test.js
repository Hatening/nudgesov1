import test from 'node:test';
import assert from 'node:assert/strict';
import {rankKnowledge,inferIntent,detectLanguage,fallbackAnswer} from '../server.js';

test('intent classifier recognizes common support intents',()=>{
 assert.equal(inferIntent('Can I return this for a refund?'),'Returns and refunds');
 assert.equal(inferIntent('Where is my shipping tracking?'),'Shipping status');
 assert.equal(inferIntent('Does the product have a warranty?'),'Product warranty');
 assert.equal(inferIntent('Hello, I have a question'),'General question');
});
test('language detection catches Chinese, Arabic, Spanish and English fallback',()=>{
 assert.equal(detectLanguage('我想申请退款'),'zh');
 assert.equal(detectLanguage('هل يوجد ضمان؟'),'ar');
 assert.equal(detectLanguage('¿Dónde está mi pedido?'),'es');
 assert.equal(detectLanguage('Where is my order?'),'en');
});
test('knowledge ranking retrieves English policies for common terms',()=>{
 assert.equal(rankKnowledge('shipping tracking has not updated')[0]?.id,'kb_demo_shipping');
 assert.equal(rankKnowledge('return and refund policy')[0]?.id,'kb_demo_returns');
 assert.equal(rankKnowledge('product warranty faulty')[0]?.id,'kb_demo_warranty');
});
test('cross-language query expansion provides a starter path for Chinese policy terms',()=>{
 assert.equal(rankKnowledge('我想申请退款，退货政策是什么？')[0]?.id,'kb_demo_returns');
 assert.equal(rankKnowledge('物流追踪没有更新')[0]?.id,'kb_demo_shipping');
});
test('unsupported questions abstain rather than inventing policy',()=>{
 const r=fallbackAnswer('Can you guarantee arrival tomorrow?',[],'en');
 assert.equal(r.grounded,false);
 assert.ok(r.confidence<0.3);
 assert.match(r.answer,/could not find enough reliable/i);
});
