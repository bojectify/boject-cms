export type PaneSegment =
  | { kind: 'entry'; entryId: string }
  | { kind: 'new'; contentTypeId: string };

const SEPARATOR = '~';
const NEW_PREFIX = 'new:';

function parseSegment(raw: string): PaneSegment {
  if (raw === SEPARATOR) {
    throw new Error('Unexpected separator while parsing segment');
  }
  if (raw.startsWith(NEW_PREFIX)) {
    const contentTypeId = raw.slice(NEW_PREFIX.length);
    if (!contentTypeId) {
      throw new Error('new: sentinel missing content type id');
    }
    return { kind: 'new', contentTypeId };
  }
  return { kind: 'entry', entryId: raw };
}

export function parseStack(segments: string[]): PaneSegment[] {
  if (segments.length === 0) {
    throw new Error('Stack is empty');
  }
  if (segments[0] === SEPARATOR) {
    throw new Error('Stack starts with separator');
  }
  if (segments[segments.length - 1] === SEPARATOR) {
    throw new Error('Stack ends with separator');
  }

  const result: PaneSegment[] = [];
  let expectingSeparator = false;

  for (const seg of segments) {
    if (expectingSeparator) {
      if (seg !== SEPARATOR) {
        throw new Error(`Expected separator, got "${seg}"`);
      }
      expectingSeparator = false;
    } else {
      result.push(parseSegment(seg));
      expectingSeparator = true;
    }
  }

  return result;
}

function encodeSegment(seg: PaneSegment): string {
  if (seg.kind === 'new') {
    return `${NEW_PREFIX}${seg.contentTypeId}`;
  }
  return seg.entryId;
}

export function encodeStack(stack: PaneSegment[]): string {
  if (stack.length === 0) {
    throw new Error('Cannot encode empty stack');
  }
  return stack.map(encodeSegment).join(`/${SEPARATOR}/`);
}

export function stackHref(stack: PaneSegment[]): string {
  return `/entries/${encodeStack(stack)}`;
}
