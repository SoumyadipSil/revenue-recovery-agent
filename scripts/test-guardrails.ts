import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  checkMaxRetries,
  checkCooldown,
  checkConfidence,
  checkAmountCap,
  checkJustification,
  applyGuardrails
} from '../src/lib/agents/decision';

describe('Decision Engine Guardrails', () => {

  test('Max Retry Cap - should block if >= 3', () => {
    const tx = { retry_count_before_agent: 3 } as any;
    assert.strictEqual(checkMaxRetries(tx, 'RETRY_NOW').passed, false);
    assert.strictEqual(checkMaxRetries({ retry_count_before_agent: 2 } as any, 'RETRY_NOW').passed, true);
  });

  test('Cooldown Window - currently a pass-through', () => {
    assert.strictEqual(checkCooldown({} as any, 'RETRY_NOW').passed, true);
  });

  test('Confidence Threshold - should block if < 0.6', () => {
    assert.strictEqual(checkConfidence(0.5).passed, false);
    assert.strictEqual(checkConfidence(0.6).passed, true);
    assert.strictEqual(checkConfidence(0.9).passed, true);
  });

  test('Amount Cap - should block if > 2000', () => {
    assert.strictEqual(checkAmountCap(2001).passed, false);
    assert.strictEqual(checkAmountCap(2000).passed, true);
    assert.strictEqual(checkAmountCap(500).passed, true);
  });

  test('Mandatory Justification - should block if empty', () => {
    assert.strictEqual(checkJustification('').passed, false);
    assert.strictEqual(checkJustification('   ').passed, false);
    assert.strictEqual(checkJustification('We need to wait for funds').passed, true);
  });

  test('Provider Failure - should immediately escalate', () => {
    const result = applyGuardrails({ amount: 100, retry_count_before_agent: 0 } as any, 0.9, 'RETRY_NOW', 'ok', 'API Timeout');
    assert.strictEqual(result.finalAction, 'ESCALATE_TO_HUMAN');
    assert.strictEqual(result.blockedReason, 'llm_unavailable');
  });

  test('applyGuardrails - blocks correctly based on rules', () => {
    // Fails amount cap
    let result = applyGuardrails({ amount: 2500, retry_count_before_agent: 0 } as any, 0.9, 'RETRY_NOW', 'ok', null);
    assert.strictEqual(result.finalAction, 'ESCALATE_TO_HUMAN');
    assert.ok(result.blockedReason?.includes('amount_cap'));

    // Fails confidence
    result = applyGuardrails({ amount: 500, retry_count_before_agent: 0 } as any, 0.4, 'RETRY_NOW', 'ok', null);
    assert.strictEqual(result.finalAction, 'ESCALATE_TO_HUMAN');
    assert.ok(result.blockedReason?.includes('confidence_threshold'));
  });

});
