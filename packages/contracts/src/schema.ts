import { z } from 'zod';

export const id = z.string().min(1).max(200);

export const path = z.string().max(4096);

export const text = z.string().max(2 * 1024 * 1024);
