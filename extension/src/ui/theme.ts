/**
 * Popup/options follow the OS colour scheme by toggling the dark semantic
 * layer in tokens.css (`.ytl-root[data-ytl-theme='dark']`). Content UI in
 * Studio follows Studio's own theme instead (html[dark]).
 */
export function followSystemTheme(root: HTMLElement = document.documentElement): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    root.dataset.ytlTheme = mq.matches ? 'dark' : 'light';
  };
  apply();
  mq.addEventListener('change', apply);
}
