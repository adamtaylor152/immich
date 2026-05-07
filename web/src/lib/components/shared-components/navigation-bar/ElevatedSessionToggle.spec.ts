import type { AuthStatusResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { eventManager } from '$lib/managers/event-manager.svelte';
import ElevatedSessionToggle from './ElevatedSessionToggle.svelte';

const appMocks = vi.hoisted(() => ({
  goto: vi.fn(),
  invalidateAll: vi.fn(),
  page: {
    data: {},
    params: {},
    route: { id: '/(user)/photos/[[assetId=id]]' },
    url: new URL('http://localhost/photos'),
  },
}));

vi.mock('$app/navigation', () => ({
  goto: appMocks.goto,
  invalidateAll: appMocks.invalidateAll,
}));

vi.mock('$app/state', () => ({
  page: appMocks.page,
}));

vi.mock('@immich/ui', async () => {
  const { default: IconButton } = await import('@test-data/components/MockIconButton.svelte');

  return {
    IconButton,
    toastManager: {
      danger: vi.fn(),
    },
  };
});

describe('ElevatedSessionToggle', () => {
  const authStatus = (overrides: Partial<AuthStatusResponseDto> = {}): AuthStatusResponseDto => ({
    isElevated: false,
    password: false,
    pinCode: true,
    ...overrides,
  });

  const setPath = (path: string, routeId = '/(user)/photos/[[assetId=id]]') => {
    appMocks.page.url = new URL(`http://localhost${path}`);
    appMocks.page.route = { id: routeId };
    appMocks.page.params = {};
  };

  const renderToggle = async (status: AuthStatusResponseDto) => {
    sdkMock.getAuthStatus.mockResolvedValue(status);
    render(ElevatedSessionToggle);
    await waitFor(() => expect(sdkMock.getAuthStatus).toHaveBeenCalled());
  };

  beforeEach(() => {
    vi.resetAllMocks();
    setPath('/photos');
  });

  it('routes locked sessions with a configured PIN to the PIN prompt', async () => {
    setPath('/photos?at=asset-1');

    await renderToggle(authStatus({ pinCode: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'unlock_sensitive_content' }));

    expect(appMocks.goto).toHaveBeenCalledWith('/auth/pin-prompt?continue=%2Fphotos%3Fat%3Dasset-1');
    expect(sdkMock.lockAuthSession).not.toHaveBeenCalled();
  });

  it('routes locked sessions without a configured PIN to the existing setup flow', async () => {
    await renderToggle(authStatus({ pinCode: false }));
    await fireEvent.click(screen.getByRole('button', { name: 'unlock_sensitive_content' }));

    expect(appMocks.goto).toHaveBeenCalledWith('/auth/pin-prompt?continue=%2Fphotos');
    expect(sdkMock.lockAuthSession).not.toHaveBeenCalled();
  });

  it('renders unlocked state for elevated sessions', async () => {
    await renderToggle(authStatus({ isElevated: true }));

    expect(screen.getByRole('button', { name: 'lock_sensitive_content' })).toBeInTheDocument();
  });

  it('locks elevated sessions and refreshes the current page state', async () => {
    const emitSpy = vi.spyOn(eventManager, 'emit');

    await renderToggle(authStatus({ isElevated: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'lock_sensitive_content' }));

    await waitFor(() => expect(sdkMock.lockAuthSession).toHaveBeenCalled());
    expect(appMocks.invalidateAll).toHaveBeenCalled();
    expect(appMocks.goto).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('SessionAccessChanged', { isElevated: false });
    expect(emitSpy).toHaveBeenCalledWith('SessionLocked');
    expect(screen.getByRole('button', { name: 'unlock_sensitive_content' })).toBeInTheDocument();
  });

  it.each([
    ['/suppressed?tab=timeline', '/(user)/suppressed/[[photos=photos]]/[[assetId=id]]'],
    ['/locked', '/(user)/locked/[[photos=photos]]/[[assetId=id]]'],
  ])('redirects to photos when locking from %s', async (path, routeId) => {
    setPath(path, routeId);

    await renderToggle(authStatus({ isElevated: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'lock_sensitive_content' }));

    await waitFor(() => expect(sdkMock.lockAuthSession).toHaveBeenCalled());
    expect(appMocks.goto).toHaveBeenCalledWith('/photos');
    expect(appMocks.invalidateAll).not.toHaveBeenCalled();
  });
});
