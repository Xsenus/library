import { z } from 'zod';

// Общая пагинация
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  query: z.string().nullish(),
});
export type PaginationParams = z.infer<typeof paginationSchema>;

// Industry
export const industrySchema = z.object({
  id: z.coerce.number(),
  industry: z.string(),
});
export const industriesQuerySchema = paginationSchema;

// Prodclass
export const prodclassSchema = z.object({
  id: z.coerce.number(),
  prodclass: z.string(),
  industry_id: z.coerce.number(),
  best_cs: z.coerce.number().nullable().optional(), // ← NEW
});
export const prodclassesQuerySchema = paginationSchema.extend({
  industryId: z.coerce.number().int().min(1),
});

// Workshop
export const workshopSchema = z.object({
  id: z.coerce.number(),
  workshop_name: z.string(),
  prodclass_id: z.coerce.number(),
  company_id: z.coerce.number(),
  workshop_score: z.coerce.number(),
  best_cs: z.coerce.number().nullable().optional(), // ← NEW
  created_at: z
    .union([z.string(), z.date()])
    .transform((v) => (v instanceof Date ? v.toISOString() : v)),
});
export const workshopsQuerySchema = paginationSchema.extend({
  prodclassId: z.coerce.number().int().min(1),
});

// Equipment (list)
export const equipmentListSchema = z.object({
  id: z.coerce.number(),
  equipment_name: z.string(),
  workshop_id: z.coerce.number(),
  equipment_score: z.coerce.number().nullable(),
  equipment_score_real: z.coerce.number().nullable(),
  clean_score: z.coerce.number().nullable(), // будем показывать как CS в списке/карточке
});

// Equipment (detail)
export const equipmentDetailSchema = z.object({
  id: z.coerce.number(),
  equipment_name: z.string(),
  workshop_id: z.coerce.number(),
  equipment_score: z.coerce.number().nullable(),
  equipment_score_real: z.coerce.number().nullable(),
  clean_score: z.coerce.number().nullable(),
  clean_url_1: z.string().nullable(),
  clean_url_2: z.string().nullable(),
  clean_url_3: z.string().nullable(),
  description: z.string(),
  description_url: z.string().nullable(),
  images_url: z.string().nullable(),
  images_promt: z.string().nullable(),
  contamination: z.string(),
  surface: z.string(),
  problems: z.string(),
  old_method: z.string(),
  old_problem: z.string(),
  benefit: z.string(),
  synonyms_ru: z.string(),
  synonyms_en: z.string(),
  blaster: z.string().nullable(),
  air: z.string().nullable(),
  rate: z.coerce.number().nullable(),
  company_id: z.coerce.number(),
  utp_post: z.string().nullable().optional(),
  utp_mail: z.string().nullable().optional(),
});

export const equipmentQuerySchema = paginationSchema.extend({
  workshopId: z.coerce.number().int().min(1),
});
export const equipmentIdSchema = z.object({
  id: z.coerce.number().int().min(1),
});

// Generic list response
export const listResponseSchema = <T>(itemSchema: z.ZodSchema<T>) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  });

export type ListResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
export type Industry = z.infer<typeof industrySchema>;
export type Prodclass = z.infer<typeof prodclassSchema>;
export type Workshop = z.infer<typeof workshopSchema>;
export type EquipmentListItem = z.infer<typeof equipmentListSchema>;
export type EquipmentDetail = z.infer<typeof equipmentDetailSchema>;

// CleanScore (строка таблицы)
export const cleanScoreRowSchema = z.object({
  equipment_id: z.coerce.number(),
  equipment_name: z.string(),
  clean_score: z.coerce.number().nullable(),

  industry_id: z.coerce.number().nullable().optional(),
  industry: z.string().nullable().optional(),

  prodclass_id: z.coerce.number().nullable().optional(),
  prodclass: z.string().nullable().optional(),

  workshop_id: z.coerce.number().nullable().optional(),
  workshop_name: z.string().nullable().optional(),

  contamination: z.string().nullable().optional(),
  surface: z.string().nullable().optional(),
  problems: z.string().nullable().optional(),
  old_method: z.string().nullable().optional(),
  old_problem: z.string().nullable().optional(),
  benefit: z.string().nullable().optional(),
});
export type CleanScoreRow = z.infer<typeof cleanScoreRowSchema>;

export const cleanScoreQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
    query: z.string().nullish(),
    minScore: z.coerce.number().min(0.85).max(1.0).default(0.95),
    maxScore: z.coerce.number().min(0.85).max(1.0).default(1.0),
    industryId: z.coerce.number().int().positive().optional().nullable(),
  })
  .refine((v) => v.maxScore >= v.minScore, {
    message: 'maxScore must be greater than or equal to minScore',
    path: ['maxScore'],
  });
