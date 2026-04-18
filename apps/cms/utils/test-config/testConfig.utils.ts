import kebabCase from 'lodash/kebabCase';

export const paddedIndex = (i: string | number): string =>
  `${i}`.padStart(4, '0');

export const testIdModifier = (
  block: string,
  element?: string
): {
  index: (i: number, addOne?: boolean) => string;
  id: (id: string) => string;
} => ({
  index: (i: number, addOne = true): string =>
    `${kebabCase(block)}${kebabCase(element) ? `__${kebabCase(element)}` : ''}--${paddedIndex(
      i + (addOne ? 1 : 0)
    )}`,
  id: (id: string): string =>
    `${kebabCase(block)}${kebabCase(element) ? `__${kebabCase(element)}` : ''}--${kebabCase(id)}`,
});

export const testIds = <T extends { [K in keyof T]: string }>(
  block: string,
  elements: T = {} as T
): {
  COMPONENT: string;
} & { [K in keyof T]: string } => ({
  COMPONENT: kebabCase(block),
  ...Object.entries(elements).reduce((acc: T, [k, v]) => {
    (acc as Record<string, string>)[k] =
      `${kebabCase(block)}__${kebabCase(v as string)}`;
    return acc;
  }, {} as T),
});
