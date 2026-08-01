import '@testing-library/jest-dom';
import { init } from 'svelte-i18n';

beforeAll(async () => {
  await init({ fallbackLocale: 'dev' });
  Element.prototype.animate = vi.fn().mockImplementation(function () {
    return { cancel: () => {}, finished: Promise.resolve() };
  });
});

if (!('part' in HTMLElement.prototype)) {
  class PartShim {
    declare getAttribute: HTMLElement['getAttribute'];
    declare setAttribute: HTMLElement['setAttribute'];

    get part() {
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
    }
  }

  const partDescriptor = Object.getOwnPropertyDescriptor(PartShim.prototype, 'part');
  if (partDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'part', { configurable: true, get: partDescriptor.get });
  }
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
