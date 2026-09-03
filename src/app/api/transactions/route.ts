import { NextResponse } from 'next/server';
import { prisma } from '@/lib/agents/executor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const transactions = await prisma.transaction.findMany({
      include: {
        classifications: true,
        audit_logs: {
          orderBy: { timestamp: 'desc' }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 50 // Limit for dashboard
    });

    return NextResponse.json(transactions);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
