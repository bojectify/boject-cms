import { readFile, writeFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

export async function readComposeImage(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8');
  const doc = parseDocument(raw);
  const image = doc.getIn(['services', 'cms', 'image']);
  if (typeof image !== 'string' || image.length === 0) {
    throw new Error(`services.cms.image not found in ${path}`);
  }
  return image;
}

export async function writeComposeImage(
  path: string,
  newRef: string
): Promise<void> {
  const raw = await readFile(path, 'utf8');
  const doc = parseDocument(raw);
  doc.setIn(['services', 'cms', 'image'], newRef);
  await writeFile(path, doc.toString());
}
