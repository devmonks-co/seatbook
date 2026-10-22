import { z } from 'zod';

export const idParam = z.coerce.number().int().positive();

export const seatIdBody = z.object({ seatId: z.coerce.number().int().positive() });
