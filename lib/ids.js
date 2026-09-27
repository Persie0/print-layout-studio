let fallbackCounter = 0;

export function createId(
  cryptoApi = typeof crypto !== "undefined" ? crypto : null,
  now = Date.now,
  random = Math.random,
) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const randomPart = typeof cryptoApi?.getRandomValues === "function"
    ? Array.from(cryptoApi.getRandomValues(new Uint32Array(2)), (part) => part.toString(36)).join("")
    : random().toString(36).slice(2);
  fallbackCounter += 1;
  return `item-${now().toString(36)}-${randomPart}-${fallbackCounter.toString(36)}`;
}
