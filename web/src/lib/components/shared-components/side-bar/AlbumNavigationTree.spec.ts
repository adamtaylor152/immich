import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AlbumNavigationTree from '$lib/components/shared-components/side-bar/AlbumNavigationTree.svelte';
import { albumFactory } from '@test-data/factories/album-factory';

const mocks = vi.hoisted(() => ({
  page: {
    params: {} as Record<string, string>,
    url: new URL('http://localhost/albums'),
  },
}));

vi.mock('$app/state', () => ({
  page: mocks.page,
}));

describe('AlbumNavigationTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.page.params = {};
    mocks.page.url = new URL('http://localhost/albums');
  });

  it('renders owned albums as a collapsed tree', async () => {
    const parent = albumFactory.build({ id: 'parent', albumName: 'Trips', parentId: null });
    const child = albumFactory.build({ id: 'child', albumName: 'Disneyland', parentId: parent.id });
    sdkMock.getAllAlbums.mockResolvedValueOnce([parent, child]);

    render(AlbumNavigationTree);

    await waitFor(() => expect(screen.getByRole('link', { name: /trips/i })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /disneyland/i })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /expand/i }));

    expect(screen.getByRole('link', { name: /disneyland/i })).toHaveAttribute('href', '/albums/child');
    expect(sdkMock.getAllAlbums).toHaveBeenCalledWith({ isOwned: true });
  });

  it('opens the active album branch from the current route params', async () => {
    const parent = albumFactory.build({ id: 'parent', albumName: 'Trips', parentId: null });
    const child = albumFactory.build({ id: 'child', albumName: 'Disneyland', parentId: parent.id });
    mocks.page.params = { albumId: child.id };
    mocks.page.url = new URL('http://localhost/albums/child');
    sdkMock.getAllAlbums.mockResolvedValueOnce([parent, child]);

    render(AlbumNavigationTree);
    await tick();

    await waitFor(() => expect(screen.getByRole('link', { name: /disneyland/i })).toBeInTheDocument());
  });
});
