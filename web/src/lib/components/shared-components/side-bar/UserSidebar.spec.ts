import { get } from 'svelte/store';

describe('album sidebar preferences', () => {
  beforeEach(() => {
    // persisted(...) reads localStorage when the module is first evaluated, so
    // reset the module registry and storage to assert the true defaults.
    vi.resetModules();
    localStorage.clear();
  });

  it('starts the nested Albums tree collapsed while preserving the recent albums shortcut preference', async () => {
    const { albumTreeDropdown, recentAlbumsDropdown } = await import('$lib/stores/preferences.store');

    expect(get(albumTreeDropdown)).toBe(false);
    expect(get(recentAlbumsDropdown)).toBe(true);
  });
});
