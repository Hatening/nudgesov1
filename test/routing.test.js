import test from 'node:test';
import assert from 'node:assert/strict';
import { LanguageCircuitBreaker, estimateLocalWasteAvoided } from '../scripts/lib/routing.mjs';

test('breaker forces language after 3 consecutive local failures', () => {
  const breaker = new LanguageCircuitBreaker(3);
  assert.equal(breaker.noteLocalFailure('pl-PL').triggered, false);
  assert.equal(breaker.noteLocalFailure('pl-PL').triggered, false);
  const third = breaker.noteLocalFailure('pl-PL');
  assert.equal(third.triggered, true);
  assert.equal(breaker.isForced('pl-PL'), true);
  assert.deepEqual(breaker.forcedLanguages(), ['pl-PL']);
});

test('local pass resets the consecutive counter', () => {
  const breaker = new LanguageCircuitBreaker(3);
  breaker.noteLocalFailure('pl-PL');
  breaker.noteLocalFailure('pl-PL');
  breaker.noteLocalPass('pl-PL');
  assert.equal(breaker.noteLocalFailure('pl-PL').triggered, false);
  assert.equal(breaker.noteLocalFailure('pl-PL').triggered, false);
  assert.equal(breaker.isForced('pl-PL'), false);
});

test('forced language stays forced and does not double-trigger', () => {
  const breaker = new LanguageCircuitBreaker(2);
  breaker.noteLocalFailure('es-ES');
  assert.equal(breaker.noteLocalFailure('es-ES').triggered, true);
  const again = breaker.noteLocalFailure('es-ES');
  assert.equal(again.triggered, false);
  assert.equal(again.forced, true);
});

test('estimateLocalWasteAvoided computes attempts, energy and money', () => {
  const result = estimateLocalWasteAvoided({
    skippedLocalCards: 2,
    maxAttempts: 4,
    avgAttemptMs: 35000,
    avgTokensPerAttempt: 1600,
    powerKw: 0.5,
    pricePerKwh: 0.6,
  });
  assert.equal(result.avoided_local_attempts, 8);
  assert.equal(result.avoided_tokens, 12800);
  assert.ok(result.avoided_cny > 0);
});
