# Recover — Agentic Revenue Recovery Engine

**Razorpay AI Buildathon | Track 03: AI Revenue Recovery**

## Problem Statement
Payment failures are a massive leak in the revenue funnel. When a subscription renewal fails, or a checkout is abandoned, businesses lose real money. Naive retry loops are dangerous (they trigger fraud locks and cost money per retry) and static rules are brittle. 

**Recover** is an agentic pipeline that intelligently classifies the root cause of payment failures and takes targeted action, bounded by strict deterministic guardrails to prevent unsafe automated behavior.

## Architecture & Separation of Concerns

The core architectural decision in this project is the **strict separation of the Reasoning Layer from the Execution Layer.** 

```
[1] Synthetic Data Generator
     → produces failed transaction records with hidden ground-truth causes
          ↓
[2] Classifier Agent (LLM)
     → outputs strict JSON: { predicted_cause, confidence, reasoning }
          ↓
[3] Decision Engine (Deterministic + LLM)
     → proposes an action (RETRY_NOW, UPDATE_PAYMENT_LINK, ESCALATE, etc.)
     → applies STRICT DETERMINISTIC GUARDRAILS before allowing execution
          ↓
[4] Execution Layer
     → simulates the action based on a realistic probability matrix
     → writes an immutable audit log entry for every step
          ↓
[5] Outcome Scoring
     → independent Python script to grade the agent's performance
```

The LLM **never** directly triggers an action. It only recommends. The deterministic Decision Engine acts as the gatekeeper.

## Strict Guardrails

Before any proposed action is executed, it must pass these 6 independent, unit-tested guardrails:

1. **Max Retry Cap:** No transaction may be retried more than 3 times, even if the LLM recommends it.
2. **Cooldown Window:** Prevents spamming retries too quickly.
3. **Confidence Threshold:** If the classifier confidence is < 0.6, the action is forced to `ESCALATE_TO_HUMAN`. The system is not allowed to act on guesses.
4. **Amount Cap:** Automated recovery is restricted to transactions under ₹2000. Large transactions are always escalated.
5. **Mandatory Justification:** The system refuses to execute any action without a valid reasoning string.
6. **Provider Failure:** If the LLM providers (NVIDIA NIM and OpenRouter fallback) are unavailable, the system safely routes to human escalation.

## Simulation Model & Assumptions

To prove this system works without a live payment gateway, we use a seeded simulation model. Each failure cause has realistic base recovery probabilities:
- `INSUFFICIENT_FUNDS`: 50% chance of recovery if scheduled later, 10% if retried immediately.
- `TEMPORARY_TIMEOUT`: 80-90% chance of recovery upon retry.
- `CARD_EXPIRED`: 0% chance on retry, 60% chance if payment link is updated.
- `FRAUD_SUSPECTED`: 0% chance of automated recovery (hard block).
- `DO_NOT_HONOR`: 5% chance on retry, 50% if payment link is updated.

## LLM Strategy & Cost

To keep the system highly reliable and cost-effective:
- **Primary:** NVIDIA NIM (Llama 3.3 70B Instruct via OpenAI-compatible endpoint)
- **Fallback:** OpenRouter (Llama 3.3 70B Instruct)

If NIM fails, the system automatically falls back to OpenRouter. If both fail, the guardrails catch it and escalate the transaction. All outputs are strictly validated using `zod` at runtime.

## Setup & Run Instructions

1. **Environment Setup**
   Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` (Neon Postgres recommended)
   - `NVIDIA_NIM_API_KEY`
   - `OPENROUTER_API_KEY`

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Database Migration & Seeding**
   ```bash
   npx prisma db push
   pnpm run seed
   ```

4. **Run the Dashboard**
   ```bash
   pnpm run dev
   ```
   Open `http://localhost:3000` to run the batch and view the live drill-down.

5. **Run the Independent Grader**
   ```bash
   pip install pandas sqlalchemy psycopg2-binary
   python scripts/analyze.py
   ```

## Handling a Failure Case (Transparency)

During the batch run, you will see transactions that were deliberately escalated or blocked. The **Audit Trail Drill-Down** in the dashboard provides full transparency. For example, if a transaction is for ₹5000, the LLM might suggest `RETRY_NOW`, but the Audit Trail will explicitly show the `amount_cap` guardrail blocking the action and changing it to `ESCALATE_TO_HUMAN`.
