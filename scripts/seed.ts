import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Simulation Assumptions (Documented for evaluator)
// Different failure causes have different base recovery probabilities
// - INSUFFICIENT_FUNDS: Medium chance (people often transfer money if reminded) - 40%
// - TEMPORARY_TIMEOUT: High chance (retrying often works) - 80%
// - CARD_EXPIRED: Low chance (requires user to update payment method) - 15%
// - FRAUD_SUSPECTED: Zero chance (bank hard block) - 0%
// - DO_NOT_HONOR: Low chance (generic decline, usually requires another card) - 20%

const FAILURE_CAUSES = [
  'INSUFFICIENT_FUNDS',
  'TEMPORARY_TIMEOUT',
  'CARD_EXPIRED',
  'FRAUD_SUSPECTED',
  'DO_NOT_HONOR',
] as const;

// Helper to generate a random number within a range
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min: number, max: number) => Math.random() * (max - min) + min;
const sample = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// To make LLM classification interesting, we provide metadata that *hints* at the cause
// without stating it explicitly in plain English all the time.
const generateMetadataForCause = (cause: string) => {
  switch (cause) {
    case 'INSUFFICIENT_FUNDS':
      return {
        decline_code: sample(['insufficient_funds', '51', 'not_enough_balance']),
        amount: randomFloat(50, 2000), // Variable amounts
        payment_method: 'card_debit',
      };
    case 'TEMPORARY_TIMEOUT':
      return {
        decline_code: sample(['processing_error', 'timeout', '91', 'issuer_unavailable']),
        amount: randomFloat(10, 500),
        payment_method: sample(['card_credit', 'upi', 'netbanking']),
      };
    case 'CARD_EXPIRED':
      return {
        decline_code: sample(['expired_card', '54']),
        amount: randomFloat(50, 500),
        payment_method: 'card_credit',
      };
    case 'FRAUD_SUSPECTED':
      return {
        decline_code: sample(['fraudulent', 'stolen_card', '59']),
        amount: randomFloat(500, 5000), // Usually higher amounts trigger fraud checks
        payment_method: 'card_credit',
      };
    case 'DO_NOT_HONOR':
      return {
        decline_code: sample(['do_not_honor', '05', 'generic_decline']),
        amount: randomFloat(20, 1000),
        payment_method: sample(['card_credit', 'card_debit']),
      };
    default:
      return { decline_code: 'unknown', amount: 100, payment_method: 'unknown' };
  }
};

async function main() {
  console.log('Clearing existing data...');
  // Delete in reverse order of dependencies
  await prisma.auditLog.deleteMany();
  await prisma.execution.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.classification.deleteMany();
  await prisma.transaction.deleteMany();

  console.log('Generating synthetic transactions...');
  const transactions = [];

  for (let i = 0; i < 75; i++) {
    const true_cause = sample(FAILURE_CAUSES);
    const meta = generateMetadataForCause(true_cause);

    transactions.push({
      amount: parseFloat(meta.amount.toFixed(2)),
      currency: 'INR',
      payment_method: meta.payment_method,
      decline_code: meta.decline_code,
      customer_tenure_days: randomInt(1, 1000),
      retry_count_before_agent: randomInt(0, 3), // 0 to 3 previous failed retries
      true_failure_cause: true_cause,
    });
  }

  // Insert to DB
  await prisma.transaction.createMany({
    data: transactions,
  });

  console.log(`Successfully generated ${transactions.length} failed transactions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
