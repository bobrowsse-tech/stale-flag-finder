export function render(client: { variation: (k: string, u: unknown, d: boolean) => boolean }) {
  if (client.variation('legacy-checkout', {}, false)) {
    return 'new';
  } else {
    return 'old';
  }
}
