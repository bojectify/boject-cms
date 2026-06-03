export const TARBALL_EXTENSIONS = ['.tar.gz', '.tgz'] as const;

/** True if the path names a bundle tarball by extension (case-insensitive). */
export function isTarballPath(path: string): boolean {
  const lower = path.toLowerCase();
  return TARBALL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True if the buffer begins with the gzip magic bytes (0x1f 0x8b). */
export function looksGzipped(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}
