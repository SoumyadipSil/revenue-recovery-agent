import { z } from 'zod';
import { callLLM } from '../llm/callLLM';
import type { Transaction } from '@prisma/client';

export const ClassifierSchema = z.object({
  predicted_cause: z.preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum([
      'INSUFFICIENT_FUNDS',
      'TEMPORARY_TIMEOUT',
      'CARD_EXPIRED',
      'FRAUD_SUSPECTED',
      'DO_NOT_HONOR',
      'UNKNOWN'
    ])
  ),
  confidence: z.number().min(0).max(1),
  reasoning_text: z.string().min(10)
});

export type ClassificationResult = z.infer<typeof ClassifierSchema>;

const SYSTEM_PROMPT = `You are an expert payment failure classifier for a revenue recovery engine.
Your job is to analyze transaction metadata and predict the root cause of the payment failure.

The possible root causes are:
- INSUFFICIENT_FUNDS: Customer does not have enough balance. Usually indicated by codes like 51, insufficient_funds, not_enough_balance.
- TEMPORARY_TIMEOUT: A transient error with the issuer or network. Usually indicated by codes like 91, timeout, processing_error.
- CARD_EXPIRED: The payment card is past its expiration date. Usually indicated by codes like 54, expired_card.
- FRAUD_SUSPECTED: The transaction was blocked by a fraud filter. Usually indicated by high amounts and codes like 59, fraudulent.
- DO_NOT_HONOR: A generic decline from the bank. Usually indicated by codes like 05, do_not_honor.
- UNKNOWN: When there isn't enough information to confidently classify.

You MUST respond with a JSON object containing EXACTLY these three keys:
{
  "predicted_cause": "one of the exact uppercase string values above",
  "confidence": 0.95,
  "reasoning_text": "your detailed reasoning"
}`;

export async function classifyTransaction(transaction: Transaction) {
  const userPrompt = `Please classify the following failed transaction:
Amount: ${transaction.amount} ${transaction.currency}
Payment Method: ${transaction.payment_method}
Decline Code: ${transaction.decline_code}
Customer Tenure (Days): ${transaction.customer_tenure_days}
Previous Retry Count: ${transaction.retry_count_before_agent}
`;

  try {
    const result = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: userPrompt,
      jsonSchema: ClassifierSchema
    });
    
    return {
      classification: result.data,
      provider: result.provider,
      error: null
    };
  } catch (error: any) {
    return {
      classification: null,
      provider: null,
      error: error.message || 'Unknown LLM error'
    };
  }
}
