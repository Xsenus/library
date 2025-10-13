import { NextRequest, NextResponse } from 'next/server';
import { getOkvedForEquipment } from '@/lib/equipment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const equipmentId = Number(params.id);
    if (!Number.isFinite(equipmentId)) {
      return NextResponse.json({ items: [] });
    }

    const items = await getOkvedForEquipment(equipmentId);
    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET /api/equipment/[id]/okved error:', e);
    return NextResponse.json({ items: [] });
  }
}
