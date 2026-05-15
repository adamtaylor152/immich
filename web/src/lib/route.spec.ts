import { OpenQueryParam } from '$lib/constants';
import { Route } from '$lib/route';

describe('Route', () => {
  describe(Route.login.name, () => {
    it('should encode continue', () => {
      expect(Route.login({ continue: '/some/path?with=query', autoLaunch: 1 })).toBe(
        '/auth/login?continue=%2Fsome%2Fpath%3Fwith%3Dquery&autoLaunch=1',
      );
    });
  });

  describe(Route.search.name, () => {
    it('should work', () => {
      expect(Route.search({})).toBe('/search');
    });

    it('should work', () => {
      expect(Route.search({ make: undefined, model: 'Immich' })).toBe('/search?query=%7B%22model%22%3A%22Immich%22%7D');
    });

    it('should support query parameters', () => {
      expect(Route.systemSettings({ isOpen: OpenQueryParam.OAUTH })).toBe('/admin/system-settings?isOpen=oauth');
    });
  });

  describe(Route.tags.name, () => {
    it('should work', () => {
      expect(Route.tags()).toBe('/tags');
    });

    it('should support query parameters', () => {
      expect(Route.tags({ path: '/some/path' })).toBe('/tags?path=%2Fsome%2Fpath');
    });

    it('should ignore an empty path', () => {
      expect(Route.tags({ path: '' })).toBe('/tags');
    });
  });

  describe(Route.recentlyAdded.name, () => {
    it('returns the recently added route', () => {
      expect(Route.recentlyAdded()).toBe('/recently-added');
      expect(Route.recentlyAdded({ at: 'asset-1' })).toBe('/recently-added?at=asset-1');
    });

    it('returns the recently added asset route', () => {
      expect(Route.viewRecentlyAddedAsset({ id: 'asset-1' })).toBe('/recently-added/asset-1');
    });
  });

  describe(Route.bestPhotos.name, () => {
    it('returns the best photos route', () => {
      expect(Route.bestPhotos()).toBe('/best-photos');
      expect(Route.bestPhotos({ page: 2, limit: 50, minScore: 0.75 })).toBe(
        '/best-photos?page=2&limit=50&minScore=0.75',
      );
    });

    it('returns the best photos asset route', () => {
      expect(Route.viewBestPhotosAsset({ id: 'asset-1' })).toBe('/best-photos/photos/asset-1');
    });
  });

  describe(Route.systemSettings.name, () => {
    it('should work', () => {
      expect(Route.systemSettings()).toBe('/admin/system-settings');
    });

    it('should support query parameters', () => {
      expect(Route.systemSettings({ isOpen: OpenQueryParam.OAUTH })).toBe('/admin/system-settings?isOpen=oauth');
    });
  });
});
