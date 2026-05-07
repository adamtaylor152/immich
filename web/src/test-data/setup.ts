import '@testing-library/jest-dom';
import { init } from 'svelte-i18n';

beforeAll(async () => {
  await init({ fallbackLocale: 'dev' });
  Element.prototype.animate = vi.fn().mockImplementation(function () {
    return { cancel: () => {}, finished: Promise.resolve() };
  });
});

if (!('part' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'part', {
    configurable: true,
    get(this: HTMLElement) {
      const getParts = () => new Set((this.getAttribute('part') ?? '').split(/\s+/).filter(Boolean));
      const setParts = (parts: Set<string>) => this.setAttribute('part', [...parts].join(' '));

      return {
        add: (...tokens: string[]) => {
          const parts = getParts();
          for (const token of tokens) {
            parts.add(token);
          }
          setParts(parts);
        },
        remove: (...tokens: string[]) => {
          const parts = getParts();
          for (const token of tokens) {
            parts.delete(token);
          }
          setParts(parts);
        },
        contains: (token: string) => getParts().has(token),
      };
    },
  });
}

Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(function (query) {
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }),
});

vi.mock('$env/dynamic/public', () => {
  return {
    env: {
      PUBLIC_IMMICH_HOSTNAME: '',
    },
  };
});
