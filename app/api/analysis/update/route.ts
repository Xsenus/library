import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  companyAnalysisInfoSchema,
  companyAnalysisStatusEnum,
} from '@/lib/validators';
import { updateCompanyAnalysis } from '@/lib/company-analysis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const datetimeSchema = z
  .union([z.string().trim().min(1), z.date()])
  .optional()
  .nullable()
  .transform((value) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  });

const updateSchema = z.object({
  inn: z.string().trim().min(1),
  status: companyAnalysisStatusEnum.optional(),
  stage: z.string().optional().nullable(),
  progress: z.coerce.number().min(0).max(100).optional(),
  rating: z.coerce.number().optional().nullable(),
  analysisOk: z.boolean().optional(),
  serverError: z.boolean().optional(),
  noValidSite: z.boolean().optional(),
  info: companyAnalysisInfoSchema.optional().nullable(),
  websites: z.array(z.string()).optional(),
  emails: z.array(z.string()).optional(),
  lastStartedAt: datetimeSchema,
  lastFinishedAt: datetimeSchema,
  durationSeconds: z.coerce.number().int().nonnegative().optional(),
  stopRequested: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = updateSchema.parse(body);
    const result = await updateCompanyAnalysis({
      inn: payload.inn,
      status: payload.status,
      stage: payload.stage ?? null,
      progress: payload.progress ?? undefined,
      rating: payload.rating ?? null,
      analysisOk: payload.analysisOk ?? undefined,
      serverError: payload.serverError ?? undefined,
      noValidSite: payload.noValidSite ?? undefined,
      info: payload.info ?? undefined,
      websites: payload.websites ?? undefined,
      emails: payload.emails ?? undefined,
      lastStartedAt: payload.lastStartedAt ?? undefined,
      lastFinishedAt: payload.lastFinishedAt ?? undefined,
      durationSeconds: payload.durationSeconds ?? undefined,
      stopRequested: payload.stopRequested ?? undefined,
    });
    return NextResponse.json({ ok: true, item: result });
  } catch (error: any) {
    console.error('POST /api/analysis/update error', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
