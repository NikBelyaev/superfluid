export function workingFileText(
  disk: string,
  deleted: boolean,
  buffer?: { text: string; dirty: boolean },
) {
  return buffer && (!deleted || buffer.dirty) ? buffer.text : disk;
}
