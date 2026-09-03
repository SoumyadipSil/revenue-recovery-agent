import os
import pandas as pd
from sqlalchemy import create_engine

def analyze_results():
    # Retrieve DATABASE_URL from environment (set by .env)
    # If not set, use a fallback for local testing
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("DATABASE_URL not found. Please set it in your environment.")
        return

    print("Connecting to database...")
    engine = create_engine(db_url)

    print("Fetching data...")
    # Read relevant tables
    transactions = pd.read_sql_table('Transaction', engine)
    classifications = pd.read_sql_table('Classification', engine)
    decisions = pd.read_sql_table('Decision', engine)
    executions = pd.read_sql_table('Execution', engine)

    if len(transactions) == 0:
        print("No transactions found in the database.")
        return

    # Merge data to get a full view of the pipeline
    df = transactions.merge(classifications, left_on='id', right_on='transaction_id', suffixes=('', '_cls'), how='left')
    df = df.merge(decisions, left_on='id_cls', right_on='classification_id', suffixes=('', '_dec'), how='left')
    df = df.merge(executions, left_on='id_dec', right_on='decision_id', suffixes=('', '_exec'), how='left')

    total_tx = len(transactions)
    processed_tx = len(df[df['id_exec'].notnull()])

    print("=" * 40)
    print("RECOVER: BATCH OUTCOME REPORT")
    print("=" * 40)
    print(f"Total Transactions: {total_tx}")
    print(f"Processed by Agent: {processed_tx}")

    if processed_tx == 0:
        print("\nNo transactions have been processed by the agent yet.")
        return

    # 1. Recovery Rate
    recovered = df[df['simulated_outcome'] == 'recovered']
    recovery_rate = (len(recovered) / total_tx) * 100
    total_recovered_amount = recovered['amount_recovered'].sum()

    print(f"\n[1] Recovery Performance")
    print(f"  Recovery Rate: {recovery_rate:.2f}%")
    print(f"  Total Amount Recovered: ₹{total_recovered_amount:.2f}")

    # 2. Classification Accuracy
    correct_classifications = df[df['predicted_cause'] == df['true_failure_cause']]
    accuracy = (len(correct_classifications) / len(classifications)) * 100
    
    print(f"\n[2] Agent Accuracy")
    print(f"  Classification Accuracy vs Ground Truth: {accuracy:.2f}%")

    # 3. Guardrail Interventions & Escalations
    escalated = df[df['action_taken'] == 'ESCALATE_TO_HUMAN']
    
    # "False Escalation" = Escalated despite high confidence and an initially proposed automated action
    false_escalations = df[
        (df['action_taken'] == 'ESCALATE_TO_HUMAN') & 
        (df['proposed_action'] != 'ESCALATE_TO_HUMAN') & 
        (df['confidence'] >= 0.8)
    ]
    
    false_escalation_rate = (len(false_escalations) / total_tx) * 100

    print(f"\n[3] Safety & Guardrails")
    print(f"  Total Human Escalations: {len(escalated)}")
    print(f"  False Escalation Rate (Blocked but high confidence): {false_escalation_rate:.2f}%")

    # Print breakdown of blocked reasons
    blocked = df[df['blocked_reason'].notnull()]
    if len(blocked) > 0:
        print("\n  Guardrail Intervention Breakdown:")
        for reason, count in blocked['blocked_reason'].value_counts().items():
            print(f"    - {reason}: {count}")

    print("\n=" * 40)

if __name__ == "__main__":
    analyze_results()
