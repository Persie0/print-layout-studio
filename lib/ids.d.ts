export function createId(
  cryptoApi?: Crypto | { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView>(array: T) => T } | null,
  now?: () => number,
  random?: () => number,
): string;
