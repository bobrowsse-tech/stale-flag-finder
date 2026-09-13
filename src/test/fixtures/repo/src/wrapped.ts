const flags = {
  isEnabled(key: string): boolean {
    return key === 'dark-mode';
  },
};

export function theme() {
  return flags.isEnabled('dark-mode') ? 'dark' : 'light';
}
