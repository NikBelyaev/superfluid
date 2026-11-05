import { fileURLToPath } from 'node:url';

export const tyExecutable = fileURLToPath(
  new URL(`./vendor/ty-${process.platform}-${process.arch}`, import.meta.url),
).replace('app.asar/', 'app.asar.unpacked/');
