import { z } from 'zod';

// Pagination
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
  best_cs: z.coerce.number().nullable().optional(),
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
  best_cs: z.coerce.number().nullable().optional(),
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
  clean_score: z.coerce.number().nullable(),
});

// Equipment (detail)
export const equipmentDetailSchema = z.object({
  id: z.coerce.number(),
  equipment_name: z.string().nullable(),
  workshop_id: z.coerce.number().nullable(),

  // Оценки
  equipment_score: z.number().nullable(),
  equipment_score_real: z.number().nullable(),
  clean_score: z.number().nullable(),

  // Ссылки/описание
  clean_url_1: z.string().nullable(),
  clean_url_2: z.string().nullable(),
  clean_url_3: z.string().nullable(),
  description: z.string().nullable(),
  description_url: z.string().nullable(),
  images_url: z.string().nullable(),
  images_promt: z.string().nullable(),

  // Контентные поля
  contamination: z.string().nullable(),
  surface: z.string().nullable(),
  problems: z.string().nullable(),
  old_method: z.string().nullable(),
  old_problem: z.string().nullable(),
  benefit: z.string().nullable(),

  // Синонимы
  synonyms_ru: z.string().nullable(),
  synonyms_en: z.string().nullable(),

  // Техпараметры/прочее
  blaster: z.string().nullable(),
  air: z.string().nullable(),
  rate: z.number().nullable(),
  company_id: z.number().nullable(),

  // Истории/шаблоны
  utp_post: z.string().nullable().optional(),
  utp_mail: z.string().nullable().optional(),

  // Центр принятия решений
  decision_pr: z.string().nullable().optional(),
  decision_prs: z.string().nullable().optional(),
  decision_sov: z.string().nullable().optional(),
  decision_operator: z.string().nullable().optional(),
  decision_proc: z.string().nullable().optional(),

  // Примеры товаров — строго массив строк или null
  goods_examples: z.array(z.string()).nullable().optional(),

  // Пример компании
  company_name: z.string().nullable().optional(),
  site_description: z.string().nullable().optional(),
});
export type EquipmentDetail = z.infer<typeof equipmentDetailSchema>;

export const equipmentQuerySchema = paginationSchema.extend({
  workshopId: z.coerce.number().int().min(1),
});
export const equipmentIdSchema = z.object({
  id: z.coerce.number().int().min(1),
});

export const equipmentPublicHashSchema = z.object({
  hash: z
    .string()
    .trim()
    .min(10)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid equipment hash format'),
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

// CleanScore (строка таблицы)
export const cleanScoreRowSchema = z.object({
  equipment_id: z.coerce.number(),
  equipment_name: z.string(),
  clean_score: z.coerce.number().nullable(),
  equipment_score_real: z.coerce.number().nullable().optional(),
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
  okved_id: z.number().nullable(),
  okved_code: z.string().nullable(),
  okved_main: z.string().nullable(),
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
    okvedId: z.coerce.number().int().optional().nullable(),
    okvedCode: z.string().trim().optional().nullable(),
  })
  .refine((v) => v.maxScore >= v.minScore, {
    message: 'maxScore must be greater than or equal to minScore',
    path: ['maxScore'],
  });

// OKVED (main list)
export const okvedMainSchema = z.object({
  id: z.coerce.number(),
  okved_code: z.string(),
  okved_main: z.string(),
});
export type OkvedMain = z.infer<typeof okvedMainSchema>;

// Companies by OKVED — ОДНА СТРОКА НА КОМПАНИЮ с историей в колонках
export const okvedCompanySchema = z.object({
  inn: z.string(),
  short_name: z.string(),
  address: z.string().nullable(),
  branch_count: z.coerce.number().nullable(),

  year: z.coerce.number().nullable(),

  // текущее
  revenue: z.coerce.number().nullable(),
  income: z.coerce.number().nullable().optional(),

  // история (из колонок "revenue-1…3"/"income-1…3")
  revenue_1: z.coerce.number().nullable().optional(),
  revenue_2: z.coerce.number().nullable().optional(),
  revenue_3: z.coerce.number().nullable().optional(),
  income_1: z.coerce.number().nullable().optional(),
  income_2: z.coerce.number().nullable().optional(),
  income_3: z.coerce.number().nullable().optional(),

  employee_count: z.coerce.number().nullable().optional(),
});
export type OkvedCompany = z.infer<typeof okvedCompanySchema>;

// Query for okved companies
export const okvedCompaniesQuerySchema = paginationSchema.extend({
  okved: z.string().optional().default(''),
});
export type OkvedCompaniesQuery = z.infer<typeof okvedCompaniesQuerySchema>;

export const aiCompanyAnalysisQuerySchema = paginationSchema.extend({
  okved: z.string().optional().default(''),
  industryId: z.string().optional().default('all'),
  q: z.string().optional().default(''),
  sort: z.enum(['revenue_desc', 'revenue_asc']).optional().default('revenue_desc'),
});
export type AiCompanyAnalysisQuery = z.infer<typeof aiCompanyAnalysisQuerySchema>;

// ОКВЭД, полученные по ID оборудования (для карточки оборудования)
export const okvedByEquipmentSchema = z.object({
  prodclass_id: z.coerce.number(),
  id: z.coerce.number(),
  okved_code: z.string(),
  okved_main: z.string(),
});
export type OkvedByEquipment = z.infer<typeof okvedByEquipmentSchema>;
