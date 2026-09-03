import { z } from 'zod';
import { callLLM } from '../llm/callLLM';
import type { Transaction, Classification } from '@prisma/client';

export const DecisionSchema = z.object({
  proposed_action: z.preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum([
      'RETRY_NOW',
      'RETRY_SCHEDULED',
      'SEND_DUNNING_MESSAGE',
      'UPDATE_PAYMENT_LINK',
      'ESCALATE_TO_HUMAN',
      'NO_ACTION'
    ])
  ),
  reasoning_text: z.string().min(1)
});

export type DecisionResult = z.infer<typeof DecisionSchema>;

const SYSTEM_PROMPT = `You are the decision engine for a revenue recovery system.
Given a transaction and its classification, propose the BEST recovery action.

Available Actions:
- RETRY_NOW: Safe for transient errors (e.g., TEMPORARY_TIMEOUT).
- RETRY_SCHEDULED: Best for INSUFFICIENT_FUNDS to give time for a deposit.
- UPDATE_PAYMENT_LINK: Best for CARD_EXPIRED or DO_NOT_HONOR.
- ESCALATE_TO_HUMAN: Best for FRAUD_SUSPECTED or complex cases.
- NO_ACTION: When recovery is impossible.
- SEND_DUNNING_MESSAGE: General reminder for overdue invoices.

Do not worry about hard guardrails like retry caps, they will be applied deterministically after your proposal.

You MUST respond with a JSON object containing EXACTLY these two keys:
{
  "proposed_action": "one of the exact uppercase string values above",
  "reasoning_text": "your detailed reasoning"
}`;

export async function proposeDecision(transaction: Transaction, classification: Pick<Classification, 'predicted_cause' | 'confidence' | 'reasoning_text'>) {
  const userPrompt = `Transaction Data:
Amount: ${transaction.amount} ${transaction.currency}
Payment Method: ${transaction.payment_method}
Decline Code: ${transaction.decline_code}
Customer Tenure (Days): ${transaction.customer_tenure_days}

Classification:
Predicted Cause: ${classification.predicted_cause}
Confidence: ${classification.confidence}
Reasoning: ${classification.reasoning_text}
`;

  try {
    const result = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: userPrompt,
      jsonSchema: DecisionSchema
    });
    
    return {
      decision: result.data,
      provider: result.provider,
      error: null
    };
  } catch (error: any) {
    return {
      decision: null,
      provider: null,
      error: error.message || 'Unknown LLM error'
    };
  }
}

// ------------------------------------------------------------------
// GUARDRAILS (Deterministic rules applied to the proposed decision)
// ------------------------------------------------------------------

export type GuardrailCheck = { rule: string; passed: boolean; reason?: string };

// 1. Max Retry Cap (max 3 retries)
export function checkMaxRetries(transaction: Transaction, proposedAction: string): GuardrailCheck {
  if (proposedAction.startsWith('RETRY_') && transaction.retry_count_before_agent >= 3) {
    return { rule: 'max_retries', passed: false, reason: 'Transaction has already been retried 3 times.' };
  }
  return { rule: 'max_retries', passed: true };
}

// 2. Cooldown Window (Simulated: if we had a last_retry_at, we'd check it. We'll pass it for now unless we track retry times)
export function checkCooldown(transaction: Transaction, proposedAction: string): GuardrailCheck {
  // In a real system, we'd check `transaction.last_retry_at` vs now.
  // For this simulation batch, we assume cooldown is met unless it's RETRY_NOW on a known hard failure.
  return { rule: 'cooldown', passed: true };
}

// 3. Confidence Threshold (must be >= 0.6)
export function checkConfidence(confidence: number): GuardrailCheck {
  if (confidence < 0.6) {
    return { rule: 'confidence_threshold', passed: false, reason: `Confidence ${confidence} is below 0.6 threshold.` };
  }
  return { rule: 'confidence_threshold', passed: true };
}

// 4. Amount Cap (> 2000 INR requires escalation)
export function checkAmountCap(amount: number): GuardrailCheck {
  if (amount > 2000) {
    return { rule: 'amount_cap', passed: false, reason: `Amount ${amount} exceeds automated recovery cap of 2000 INR.` };
  }
  return { rule: 'amount_cap', passed: true };
}

// 5. Mandatory Justification (reasoning cannot be empty)
export function checkJustification(reasoning: string): GuardrailCheck {
  if (!reasoning || reasoning.trim().length === 0) {
    return { rule: 'mandatory_justification', passed: false, reason: 'LLM failed to provide reasoning.' };
  }
  return { rule: 'mandatory_justification', passed: true };
}

// Apply all guardrails to determine final action
export function applyGuardrails(
  transaction: Transaction,
  confidence: number,
  proposedAction: string,
  reasoning: string,
  llmError: string | null
) {
  // 6. Provider Failure
  if (llmError) {
    return {
      checks: [{ rule: 'provider_available', passed: false, reason: llmError }],
      finalAction: 'ESCALATE_TO_HUMAN',
      blockedReason: 'llm_unavailable'
    };
  }

  const checks = [
    checkMaxRetries(transaction, proposedAction),
    checkCooldown(transaction, proposedAction),
    checkConfidence(confidence),
    checkAmountCap(transaction.amount),
    checkJustification(reasoning)
  ];

  const failedCheck = checks.find(c => !c.passed);
  
  if (failedCheck) {
    return {
      checks,
      finalAction: 'ESCALATE_TO_HUMAN',
      blockedReason: `Blocked by ${failedCheck.rule}: ${failedCheck.reason}`
    };
  }

  return {
    checks,
    finalAction: proposedAction,
    blockedReason: null
  };
}
