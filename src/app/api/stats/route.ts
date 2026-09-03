import { NextResponse } from 'next/server';
import { prisma } from '@/lib/agents/executor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const totalTransactions = await prisma.transaction.count();
    
    // Recovery stats
    const executions = await prisma.execution.findMany({
      include: {
        decision: {
          include: {
            classification: {
              include: {
                transaction: true
              }
            }
          }
        }
      }
    });

    const recoveredExecutions = executions.filter(e => e.simulated_outcome === 'recovered');
    const totalRecoveredAmount = recoveredExecutions.reduce((acc, curr) => acc + curr.amount_recovered, 0);
    const recoveryRate = totalTransactions > 0 ? (recoveredExecutions.length / totalTransactions) * 100 : 0;

    // False Escalations (Cases escalated but we could have maybe handled them... though hard to say.
    // Let's just count escalations that had high confidence)
    const escalatedDecisions = executions.filter(e => e.action_taken === 'ESCALATE_TO_HUMAN');
    const falseEscalations = escalatedDecisions.filter(e => e.decision.classification.confidence > 0.8 && e.decision.proposed_action !== 'ESCALATE_TO_HUMAN');

    // Classification Accuracy vs True Cause
    const classifications = await prisma.classification.findMany({
      include: { transaction: true }
    });
    const correctClassifications = classifications.filter(c => c.predicted_cause === c.transaction.true_failure_cause);
    const accuracy = classifications.length > 0 ? (correctClassifications.length / classifications.length) * 100 : 0;

    return NextResponse.json({
      total_transactions: totalTransactions,
      processed: executions.length,
      recovery_rate: recoveryRate.toFixed(2),
      total_recovered_amount: totalRecoveredAmount.toFixed(2),
      accuracy: accuracy.toFixed(2),
      escalations: escalatedDecisions.length,
      false_escalations: falseEscalations.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
