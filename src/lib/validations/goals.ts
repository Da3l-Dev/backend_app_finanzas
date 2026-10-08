import { z } from "zod";

export const goalSchema = z.object({
  name: z.string().trim().min(2).max(80),
  targetAmount: z.number().positive().max(999999999),
  description: z.string().max(500).optional(),
  targetDate: z.iso.datetime().optional(),
}).strict();
