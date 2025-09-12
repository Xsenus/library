import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { industriesQuerySchema, industrySchema, listResponseSchema } from '@/lib/validators';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = industriesQuerySchema.parse({
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: searchParams.get('query'),
    });

    const { page, pageSize, query } = params;
    const offset = (page - 1) * pageSize;

    // Count total items
    const countResult = await db.query(
      `SELECT COUNT(*) as count 
       FROM ib_industry 
       WHERE ($1::text IS NULL OR industry ILIKE '%'||$1||'%')`,
      [query || null],
    );

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / pageSize);

    // Get items
    const result = await db.query(
      `SELECT id, industry 
       FROM ib_industry 
       WHERE ($1::text IS NULL OR industry ILIKE '%'||$1||'%') 
       ORDER BY industry 
       LIMIT $2 OFFSET $3`,
      [query || null, pageSize, offset],
    );

    const items = result.rows.map((row) => industrySchema.parse(row));

    const response = {
      items,
      page,
      pageSize,
      total,
      totalPages,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Industries API error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
