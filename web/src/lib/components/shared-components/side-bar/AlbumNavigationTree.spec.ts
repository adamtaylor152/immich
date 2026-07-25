import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AlbumNavigationTree from '$lib/components/shared-components/side-bar/AlbumNavigationTree.svelte';
import { ALBUM_DRAG_MIME } from '$lib/utils/album-drag';
import { albumFactory } from '@test-data/factories/album-factory';

const mocks = vi.hoisted(() => ({
  page: {
    params: {} as Record<string, string>,
    url: new URL('http://localhost/albums'),
  },
  invalidate: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: mocks.page,
}));

vi.mock('$app/navigation', () => ({
  invalidate: mocks.invalidate,
  goto: vi.fn(),
}));

const albumDragTransfer = (albumId: string) => ({
  types: [ALBUM_DRAG_MIME],
  getData: (type: string) => (type === ALBUM_DRAG_MIME ? albumId : ''),
  setData: vi.fn(),
  dropEffect: 'none',
  effectAllowed: 'none',
});

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

  it('nests one album into another when a row is dropped on it', async () => {
    const trips = albumFactory.build({ id: 'trips', albumName: 'Trips', parentId: null });
    const paris = albumFactory.build({ id: 'paris', albumName: 'Paris', parentId: null });
    sdkMock.getAllAlbums.mockResolvedValue([trips, paris]);
    sdkMock.updateAlbumInfo.mockResolvedValue(paris);

    render(AlbumNavigationTree);
    await waitFor(() => expect(screen.getByRole('link', { name: /paris/i })).toBeInTheDocument());

    const dataTransfer = albumDragTransfer(paris.id);
    await fireEvent.dragStart(screen.getByRole('link', { name: /paris/i }), { dataTransfer });
    await fireEvent.drop(screen.getByRole('link', { name: /trips/i }), { dataTransfer });

    await waitFor(() =>
      expect(sdkMock.updateAlbumInfo).toHaveBeenCalledWith({
        id: paris.id,
        updateAlbumDto: { parentId: trips.id },
      }),
    );
  });

  it('moves an album to the top level when dropped on the top-level zone', async () => {
    const trips = albumFactory.build({ id: 'trips', albumName: 'Trips', parentId: null });
    const paris = albumFactory.build({ id: 'paris', albumName: 'Paris', parentId: trips.id });
    sdkMock.getAllAlbums.mockResolvedValue([trips, paris]);
    sdkMock.updateAlbumInfo.mockResolvedValue(paris);

    render(AlbumNavigationTree);
    await waitFor(() => expect(screen.getByRole('link', { name: /trips/i })).toBeInTheDocument());

    // The top-level zone only appears while an album drag is in flight.
    expect(screen.queryByText(/top.level/i)).not.toBeInTheDocument();

    const dataTransfer = albumDragTransfer(paris.id);
    await fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    await fireEvent.dragStart(screen.getByRole('link', { name: /paris/i }), { dataTransfer });

    const zone = await screen.findByText(/top.level/i);
    await fireEvent.drop(zone, { dataTransfer });

    await waitFor(() =>
      expect(sdkMock.updateAlbumInfo).toHaveBeenCalledWith({
        id: paris.id,
        updateAlbumDto: { parentId: null },
      }),
    );
  });
});
