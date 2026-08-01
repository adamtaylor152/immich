import { matchesAlbumSearch } from '$lib/utils/album-utils';
import { albumFactory } from '@test-data/factories/album-factory';

describe('matchesAlbumSearch', () => {
  it('matches album names across punctuation boundaries', () => {
    const album = albumFactory.build({ albumName: '2004 - Family Vacation - Disneyland', description: '' });

    expect(matchesAlbumSearch(album, '2004 family vacation')).toBe(true);
  });

  it('matches query tokens regardless of order', () => {
    const album = albumFactory.build({ albumName: '2004 - Family Vacation - Disneyland', description: '' });

    expect(matchesAlbumSearch(album, 'vacation 2004 disneyland')).toBe(true);
  });

  it('matches tokens from the album description', () => {
    const album = albumFactory.build({ albumName: 'Disneyland', description: 'Family trip from 2004' });

    expect(matchesAlbumSearch(album, 'family 2004')).toBe(true);
  });

  it('filters out albums missing one or more query tokens', () => {
    const album = albumFactory.build({ albumName: '2004 - Family Vacation - Disneyland', description: '' });

    expect(matchesAlbumSearch(album, '2004 family beach')).toBe(false);
  });

  it('treats a blank query as a match', () => {
    const album = albumFactory.build({ albumName: 'Disneyland', description: '' });

    expect(matchesAlbumSearch(album, ' '.repeat(3))).toBe(true);
  });
});
