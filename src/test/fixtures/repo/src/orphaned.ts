export function beta(flags: { isEnabled: (k: string) => boolean }) {
  if (flags.isEnabled('deleted-upstream-flag')) {
    return 'beta';
  }
  return 'stable';
}
