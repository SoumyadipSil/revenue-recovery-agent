import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/agents/executor';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        classifications: {
          orderBy: { created_at: 'desc' }
        },
        audit_logs: {
          orderBy: { timestamp: 'desc' }
        }
      }
    });

    if (!transaction) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const decisions = await prisma.decision.findMany({
      where: { transaction_id: id },
      include: {
        executions: {
          orderBy: { executed_at: 'desc' }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    return NextResponse.json({
      transaction,
      decisions
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
