import { cleanup, render, screen } from '@testing-library/svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import NavigationBar from './NavigationBar.svelte';

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  page: {
    data: {},
    params: {},
    route: { id: '/(user)/photos/[[assetId=id]]' },
    url: new URL('http://localhost/photos'),
  },
  notificationManager: {
    notifications: [],
    refresh: vi.fn().mockResolvedValue(undefined),
  },
  sidebarStore: {
    isOpen: false,
    toggle: vi.fn(),
  },
}));

vi.mock('$app/state', () => ({
  page: mocks.page,
}));

vi.mock('$lib/components/shared-components/search-bar/SearchBar.svelte', async () => {
  const { default: MockIcon } = await import('@test-data/components/MockIcon.svelte');

  return { default: MockIcon };
});

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: {
    value: { search: true },
  },
}));

vi.mock('$lib/stores/media-query-manager.svelte', () => ({
  mediaQueryManager: {
    isFullSidebar: false,
  },
}));

vi.mock('$lib/stores/notification-manager.svelte', () => ({
  notificationManager: mocks.notificationManager,
}));

vi.mock('$lib/stores/sidebar.svelte', () => ({
  sidebarStore: mocks.sidebarStore,
}));

vi.mock('@immich/ui', async () => {
  const { default: Button } = await import('@test-data/components/MockButton.svelte');
  const { default: IconButton } = await import('@test-data/components/MockIconButton.svelte');
  const { default: Icon } = await import('@test-data/components/MockIcon.svelte');

  return {
    ActionButton: Button,
    Button,
    Icon,
    IconButton,
    Logo: Icon,
  };
});

vi.mock('../ThemeButton.svelte', async () => {
  const { default: MockIcon } = await import('@test-data/components/MockIcon.svelte');

  return { default: MockIcon };
});

vi.mock('../UserAvatar.svelte', async () => {
  const { default: MockIcon } = await import('@test-data/components/MockIcon.svelte');

  return { default: MockIcon };
});

vi.mock('./AccountInfoPanel.svelte', async () => {
  const { default: MockIcon } = await import('@test-data/components/MockIcon.svelte');

  return { default: MockIcon };
});

vi.mock('./ElevatedSessionToggle.svelte', async () => {
  const { default: MockIcon } = await import('@test-data/components/MockIcon.svelte');

  return { default: MockIcon };
});

vi.mock('./NotificationPanel.svelte', async () => {
  const { default: MockIcon } = await import('@test-data/components/MockIcon.svelte');

  return { default: MockIcon };
});

describe('NavigationBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authManager.setUser(userAdminFactory.build());
    authManager.setPreferences(preferencesFactory.build());
  });

  afterEach(() => {
    cleanup();
    authManager.reset();
  });

  it('navigates to search from the mobile top-nav search button', () => {
    const { container } = render(NavigationBar);
    const searchButton = container.querySelector('#search-button');

    expect(searchButton).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByRole('button', { name: 'go_to_search' })).toHaveAttribute('href', '/search');
  });
});
