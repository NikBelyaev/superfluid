import { createHash } from 'node:crypto';

export const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
