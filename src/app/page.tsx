'use client';

import { useState, useEffect } from 'react';
import { Play, Activity, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

type Transaction = {
  id: string;
  amount: number;
  currency: string;
  payment_method: string;
  decline_code: string;
  true_failure_cause: string;
  created_at: string;
  classifications: any[];
  audit_logs: any[];
};

type Stats = {
  total_transactions: number;
  processed: number;
  recovery_rate: string;
  total_recovered_amount: string;
  accuracy: string;
  escalations: number;
  false_escalations: number;
};

export default function Dashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, any>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  const fetchTransactions = async () => {
    const res = await fetch('/api/transactions');
    if (res.ok) {
      const data = await res.json();
      setTransactions(data);
    }
  };

  const fetchStats = async () => {
    const res = await fetch('/api/stats');
    if (res.ok) {
      const data = await res.json();
      setStats(data);
    }
  };

  useEffect(() => {
    fetchTransactions();
    fetchStats();
  }, []);

  const runBatch = async () => {
    setIsRunning(true);
    setProgress({});

    const eventSource = new EventSource('/api/batch');

    eventSource.addEventListener('start', (e) => {
      console.log('Batch started:', JSON.parse(e.data));
    });

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      setProgress(prev => ({
        ...prev,
        [data.transactionId]: data
      }));
    });

    eventSource.addEventListener('transaction_completed', (e) => {
      const data = JSON.parse(e.data);
      setProgress(prev => ({
        ...prev,
        [data.transactionId]: { ...prev[data.transactionId], ...data, status: 'Completed' }
      }));
      // Refresh list periodically
      fetchTransactions();
    });

    eventSource.addEventListener('done', (e) => {
      console.log('Batch completed');
      eventSource.close();
      setIsRunning(false);
      fetchTransactions();
      fetchStats();
    });

    eventSource.addEventListener('error', (e) => {
      console.error('Batch error:', e);
      eventSource.close();
      setIsRunning(false);
    });
  };

  const selectedTx = transactions.find(t => t.id === selectedTxId);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* HEADER */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Recover</h1>
            <p className="text-gray-500">Agentic Revenue Recovery Engine</p>
          </div>
          <button
            onClick={runBatch}
            disabled={isRunning}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-white transition-colors ${isRunning ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {isRunning ? <Activity className="animate-spin w-5 h-5" /> : <Play className="w-5 h-5" />}
            {isRunning ? 'Running Batch...' : 'Run Pipeline'}
          </button>
        </header>

        {/* METRICS */}
        {stats && (
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard title="Recovery Rate" value={`${stats.recovery_rate}%`} icon={<Activity className="w-6 h-6 text-green-500" />} />
            <MetricCard title="Total Recovered" value={`₹${stats.total_recovered_amount}`} icon={<CheckCircle className="w-6 h-6 text-green-500" />} />
            <MetricCard title="Classification Accuracy" value={`${stats.accuracy}%`} icon={<CheckCircle className="w-6 h-6 text-blue-500" />} />
            <MetricCard title="Escalations (False+)" value={`${stats.escalations} (${stats.false_escalations})`} icon={<AlertTriangle className="w-6 h-6 text-orange-500" />} />
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* TRANSACTIONS LIST */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h2 className="font-semibold">Batch Transactions</h2>
              <span className="text-sm text-gray-500">{transactions.length} total</span>
            </div>
            <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
              {transactions.map(tx => {
                const liveProgress = progress[tx.id];
                const hasRun = tx.classifications.length > 0 || liveProgress;

                return (
                  <div
                    key={tx.id}
                    onClick={() => setSelectedTxId(tx.id)}
                    className={`p-4 hover:bg-blue-50 cursor-pointer transition-colors ${selectedTxId === tx.id ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex gap-3 items-center">
                        <span className="font-mono text-sm text-gray-500">...{tx.id.slice(-8)}</span>
                        <span className="font-semibold text-lg">₹{tx.amount}</span>
                      </div>
                      <div>
                        {liveProgress ? (
                          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded-full animate-pulse">
                            {liveProgress.status}
                          </span>
                        ) : hasRun ? (
                          <span className="text-xs font-semibold px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
                            Processed
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-1 bg-gray-100 text-gray-500 rounded-full">
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-gray-600 flex gap-4">
                      <span>Cause: <span className="font-medium text-gray-900">{tx.true_failure_cause}</span></span>
                      <span>Decline: {tx.decline_code}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TRANSACTION DRILL-DOWN */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-[650px]">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h2 className="font-semibold">Audit Trail Drill-Down</h2>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              {selectedTx ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Metadata</h3>
                    <pre className="text-xs bg-gray-50 p-3 rounded-lg border border-gray-100 overflow-x-auto">
                      {JSON.stringify({
                        id: selectedTx.id,
                        amount: selectedTx.amount,
                        true_cause: selectedTx.true_failure_cause
                      }, null, 2)}
                    </pre>
                  </div>

                  {selectedTx.audit_logs.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Event Log</h3>
                      <div className="space-y-4">
                        {selectedTx.audit_logs.map((log: any, idx: number) => (
                          <div key={idx} className="relative pl-4 border-l-2 border-gray-200">
                            <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full -left-[7px] top-1"></div>
                            <div className="text-sm font-medium mb-1">{log.event_type}</div>
                            <pre className="text-xs bg-gray-50 p-2 rounded border border-gray-100 overflow-x-auto text-gray-700">
                              {JSON.stringify(log.payload, null, 2)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-8">
                      No audit logs yet. Run the pipeline.
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">
                  Select a transaction to view its audit trail.
                </div>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

function MetricCard({ title, value, icon }: { title: string, value: string, icon: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
      <div className="p-3 bg-gray-50 rounded-lg">
        {icon}
      </div>
    </div>
  );
}
