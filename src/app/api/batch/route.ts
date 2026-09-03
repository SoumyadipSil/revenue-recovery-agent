import { NextRequest } from 'next/server';
import { prisma, writeAuditLog, simulateExecution } from '@/lib/agents/executor';
import { classifyTransaction } from '@/lib/agents/classifier';
import { proposeDecision, applyGuardrails } from '@/lib/agents/decision';

// Force dynamic to prevent caching
export const dynamic = 'force-dynamic';
// Max duration for the API route (Vercel standard max limit for hobby is 10s, pro is 60s/300s)
// But since we are streaming, we might be fine.
export const maxDuration = 300; 

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Fetch all transactions without a classification (unprocessed)
        const transactions = await prisma.transaction.findMany({
          where: { classifications: { none: {} } },
          take: 20 // Process in smaller batches for the demo if there are many
        });

        sendEvent('start', { total: transactions.length });

        for (const tx of transactions) {
          sendEvent('progress', { transactionId: tx.id, status: 'Classifying...' });
          
          // 1. Classification
          const classificationResult = await classifyTransaction(tx);
          const classification = await prisma.classification.create({
            data: {
              transaction_id: tx.id,
              predicted_cause: classificationResult.classification?.predicted_cause || 'UNKNOWN',
              confidence: classificationResult.classification?.confidence || 0,
              reasoning_text: classificationResult.classification?.reasoning_text || classificationResult.error || '',
              model_used: classificationResult.provider || 'unknown',
            }
          });
          
          await writeAuditLog(tx.id, 'classification_completed', {
            classificationId: classification.id,
            result: classificationResult.classification,
            provider: classificationResult.provider,
            error: classificationResult.error
          });

          sendEvent('progress', { transactionId: tx.id, status: 'Deciding...' });

          // 2. Decision Proposal
          let proposedAction = 'NO_ACTION';
          let decisionReasoning = 'Skipped due to classification error';
          let decisionProvider = null;
          let llmError = classificationResult.error;

          if (!llmError) {
            const decisionResult = await proposeDecision(tx, classification);
            if (decisionResult.error) {
              llmError = decisionResult.error;
            } else {
              proposedAction = decisionResult.decision?.proposed_action || 'NO_ACTION';
              decisionReasoning = decisionResult.decision?.reasoning_text || '';
              decisionProvider = decisionResult.provider;
            }
          }

          sendEvent('progress', { transactionId: tx.id, status: 'Guardrails check...' });

          // 3. Guardrails
          const guardrailOutcome = applyGuardrails(
            tx,
            classification.confidence,
            proposedAction,
            decisionReasoning,
            llmError
          );

          const decision = await prisma.decision.create({
            data: {
              transaction_id: tx.id,
              classification_id: classification.id,
              proposed_action: proposedAction,
              guardrail_checks: guardrailOutcome.checks,
              final_action: guardrailOutcome.finalAction,
              blocked_reason: guardrailOutcome.blockedReason,
            }
          });

          await writeAuditLog(tx.id, 'decision_made', {
            decisionId: decision.id,
            proposed: proposedAction,
            final: guardrailOutcome.finalAction,
            blockedReason: guardrailOutcome.blockedReason,
            guardrails: guardrailOutcome.checks
          });

          sendEvent('progress', { transactionId: tx.id, status: 'Executing...' });

          // 4. Execution Simulation
          const simOutcome = await simulateExecution(
            guardrailOutcome.finalAction,
            tx.true_failure_cause,
            tx.amount
          );

          const execution = await prisma.execution.create({
            data: {
              decision_id: decision.id,
              action_taken: guardrailOutcome.finalAction,
              simulated_outcome: simOutcome.outcome,
              amount_recovered: simOutcome.amount_recovered,
            }
          });

          await writeAuditLog(tx.id, 'execution_completed', {
            executionId: execution.id,
            action: guardrailOutcome.finalAction,
            outcome: simOutcome.outcome,
            amount_recovered: simOutcome.amount_recovered
          });

          sendEvent('transaction_completed', { 
            transactionId: tx.id, 
            finalAction: guardrailOutcome.finalAction,
            outcome: simOutcome.outcome,
            amountRecovered: simOutcome.amount_recovered
          });
        }

        sendEvent('done', { message: 'Batch completed' });
        controller.close();
      } catch (error: any) {
        console.error('Batch error:', error);
        sendEvent('error', { message: error.message });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
