'use strict';

// Loaded in <head> before the stylesheet so a saved light-theme choice applies before first paint.
// Dark (IBM Carbon Gray 100) is the default for everyone who hasn't picked a theme.
(() => {
  const KEY = 'crusalis:theme';
  const root = document.documentElement;

  function savedTheme() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null; // Storage blocked: fall back to the default theme.
    }
  }

  function remember(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Storage blocked: the choice still applies until the page is closed.
    }
  }

  function apply(theme) {
    root.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }

  apply(savedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    const buttons = [...document.querySelectorAll('#theme-switch [data-theme-choice]')];
    const sync = () => buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === root.dataset.theme)));
    for (const button of buttons) {
      button.addEventListener('click', () => {
        apply(button.dataset.themeChoice);
        remember(root.dataset.theme);
        sync();
      });
    }
    sync();
  });
})();
