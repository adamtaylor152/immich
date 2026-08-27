import { BadRequestException } from '@nestjs/common';
import { mapAsset } from 'src/dtos/asset-response.dto';
import { SearchSuggestionType } from 'src/dtos/search.dto';
import { Permission } from 'src/enum';
import { SearchService } from 'src/services/search.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { PersonFactory } from 'test/factories/person.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { getForAsset } from 'test/mappers';
import { newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, vitest } from 'vitest';

vitest.useFakeTimers();

describe(SearchService.name, () => {
  let sut: SearchService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SearchService));
    mocks.partner.getAll.mockResolvedValue([]);
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('searchPerson', () => {
    it('should pass options to search', async () => {
      const auth = AuthFactory.create();
      const name = 'foo';

      mocks.person.getByName.mockResolvedValue([]);

      await sut.searchPerson(auth, { name, withHidden: false });

      expect(mocks.person.getByName).toHaveBeenCalledWith(auth.user.id, name, { withHidden: false });

      await sut.searchPerson(auth, { name, withHidden: true });

      expect(mocks.person.getByName).toHaveBeenCalledWith(auth.user.id, name, { withHidden: true });
    });
  });

  describe('searchPlaces', () => {
    it('should search places', async () => {
      mocks.search.searchPlaces.mockResolvedValue([
        {
          id: 42,
          name: 'my place',
          latitude: 420,
          longitude: 69,
          admin1Code: null,
          admin1Name: null,
          admin2Code: null,
          admin2Name: null,
          alternateNames: null,
          countryCode: 'US',
          modificationDate: new Date(),
        },
      ]);

      await sut.searchPlaces({ name: 'place' });
      expect(mocks.search.searchPlaces).toHaveBeenCalledWith('place');
    });
  });

  describe('getExploreData', () => {
    it('should get recent assets and assets by city and tag', async () => {
      const auth = AuthFactory.create();
      const asset = AssetFactory.from()
        .exif({ latitude: 42, longitude: 69, city: 'city', state: 'state', country: 'country' })
        .build();
      mocks.asset.getAssetIdByCity.mockResolvedValue({
        fieldName: 'exifInfo.city',
        items: [{ value: 'city', data: asset.id }],
      });
      mocks.asset.getRecentlyCreatedAssetIds.mockResolvedValue({
        fieldName: 'createdAt',
        items: [{ value: asset.createdAt, data: asset.id }],
      });
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([asset as never]);
      const expectedResponse = [
        { fieldName: 'exifInfo.city', items: [{ value: 'city', data: mapAsset(getForAsset(asset)) }] },
        {
          fieldName: 'createdAt',
          items: [{ value: asset.createdAt.toISOString(), data: mapAsset(getForAsset(asset)) }],
        },
      ];

      const result = await sut.getExploreData(auth);

      expect(result).toEqual(expectedResponse);
    });

    it('should exclude NSFW assets when privacy hiding is active', async () => {
      const auth = { ...AuthFactory.create(), hideNsfwAssets: true };
      mocks.asset.getAssetIdByCity.mockResolvedValue({
        fieldName: 'exifInfo.city',
        items: [],
      });
      mocks.asset.getRecentlyCreatedAssetIds.mockResolvedValue({
        fieldName: 'createdAt',
        items: [],
      });
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([]);

      await sut.getExploreData(auth);

      expect(mocks.asset.getAssetIdByCity).toHaveBeenCalledWith(auth.user.id, {
        maxFields: 12,
        minAssetsPerField: 5,
        excludeNsfw: true,
      });
    });
  });

  describe('getSearchSuggestions', () => {
    it('should return search suggestions for country', async () => {
      mocks.search.getCountries.mockResolvedValue(['USA']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.COUNTRY }),
      ).resolves.toEqual(['USA']);
      expect(mocks.search.getCountries).toHaveBeenCalledWith([authStub.user1.user.id], {});
    });

    it('should exclude NSFW assets from suggestions when privacy hiding is active', async () => {
      const auth = { ...authStub.user1, hideNsfwAssets: true };
      mocks.search.getCountries.mockResolvedValue(['USA']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(auth, { includeNull: false, type: SearchSuggestionType.COUNTRY }),
      ).resolves.toEqual(['USA']);

      expect(mocks.search.getCountries).toHaveBeenCalledWith([auth.user.id], { excludeNsfw: true });
    });

    it('should return search suggestions for country (including null)', async () => {
      mocks.search.getCountries.mockResolvedValue(['USA']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.COUNTRY }),
      ).resolves.toEqual(['USA', null]);
      expect(mocks.search.getCountries).toHaveBeenCalledWith([authStub.user1.user.id], {});
    });

    it('should return search suggestions for state', async () => {
      mocks.search.getStates.mockResolvedValue(['California']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.STATE }),
      ).resolves.toEqual(['California']);
      expect(mocks.search.getStates).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for state (including null)', async () => {
      mocks.search.getStates.mockResolvedValue(['California']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.STATE }),
      ).resolves.toEqual(['California', null]);
      expect(mocks.search.getStates).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for city', async () => {
      mocks.search.getCities.mockResolvedValue(['Denver']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CITY }),
      ).resolves.toEqual(['Denver']);
      expect(mocks.search.getCities).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for city (including null)', async () => {
      mocks.search.getCities.mockResolvedValue(['Denver']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CITY }),
      ).resolves.toEqual(['Denver', null]);
      expect(mocks.search.getCities).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera make', async () => {
      mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_MAKE }),
      ).resolves.toEqual(['Nikon']);
      expect(mocks.search.getCameraMakes).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera make (including null)', async () => {
      mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_MAKE }),
      ).resolves.toEqual(['Nikon', null]);
      expect(mocks.search.getCameraMakes).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera model', async () => {
      mocks.search.getCameraModels.mockResolvedValue(['Fujifilm X100VI']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_MODEL }),
      ).resolves.toEqual(['Fujifilm X100VI']);
      expect(mocks.search.getCameraModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera model (including null)', async () => {
      mocks.search.getCameraModels.mockResolvedValue(['Fujifilm X100VI']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_MODEL }),
      ).resolves.toEqual(['Fujifilm X100VI', null]);
      expect(mocks.search.getCameraModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera lens model', async () => {
      mocks.search.getCameraLensModels.mockResolvedValue(['10-24mm']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_LENS_MODEL }),
      ).resolves.toEqual(['10-24mm']);
      expect(mocks.search.getCameraLensModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera lens model (including null)', async () => {
      mocks.search.getCameraLensModels.mockResolvedValue(['10-24mm']);
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_LENS_MODEL }),
      ).resolves.toEqual(['10-24mm', null]);
      expect(mocks.search.getCameraLensModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });
  });

  describe('searchSmart', () => {
    beforeEach(() => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: false, items: [] });
      mocks.machineLearning.encodeText.mockResolvedValue('[1, 2, 3]');
    });

    it('should raise a BadRequestException if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false },
      });

      await expect(sut.searchSmart(authStub.user1, { query: 'test' })).rejects.toThrowError(
        new BadRequestException('Smart search is not enabled'),
      );
    });

    it('should raise a BadRequestException if smart search is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { enabled: false } },
      });

      await expect(sut.searchSmart(authStub.user1, { query: 'test' })).rejects.toThrowError(
        new BadRequestException('Smart search is not enabled'),
      );
    });

    it('should work', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ modelName: expect.any(String) }),
      );
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        {
          query: 'test',
          embedding: '[1, 2, 3]',
          userIds: [authStub.user1.user.id],
          viewingUserId: authStub.user1.user.id,
          visibility: 'not-locked',
        },
      );
    });

    it('should exclude NSFW assets when privacy hiding is active', async () => {
      const auth = { ...authStub.user1, hideNsfwAssets: true };

      await sut.searchSmart(auth, { query: 'test' });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        { query: 'test', embedding: '[1, 2, 3]', userIds: [auth.user.id], excludeNsfw: true, visibility: 'not-locked' },
      );
    });

    it('should consider page and size parameters', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test', page: 2, size: 50 });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ modelName: expect.any(String) }),
      );
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 2, size: 50 },
        expect.objectContaining({ query: 'test', embedding: '[1, 2, 3]', userIds: [authStub.user1.user.id] }),
      );
    });

    it('should use clip model specified in config', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { modelName: 'ViT-B-16-SigLIP__webli' } },
      });

      await sut.searchSmart(authStub.user1, { query: 'test' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ modelName: 'ViT-B-16-SigLIP__webli' }),
      );
    });

    it('should use language specified in request', async () => {
      await sut.searchSmart(authStub.user1, { query: 'test', language: 'de' });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ language: 'de' }),
      );
    });
  });

  describe('askSearch', () => {
    beforeEach(() => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: false, items: [] });
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      mocks.machineLearning.encodeText.mockResolvedValue('[1, 2, 3]');
      mocks.person.getByName.mockResolvedValue([]);
    });

    it('should answer natural language searches with smart search and structured filters', async () => {
      const result = await sut.askSearch(authStub.user1, { query: 'photos of Alice in Banff last summer' });

      expect(result.plan.mode).toBe('smart');
      expect(result.plan.filters).toEqual(
        expect.objectContaining({
          city: 'Banff',
          type: 'IMAGE',
          withExif: true,
        }),
      );
      expect(result.warnings).toEqual([
        'People names are searched semantically until Ask Search can resolve names to person IDs.',
      ]);
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          city: 'Banff',
          embedding: '[1, 2, 3]',
          query: 'photos of Alice in Banff last summer',
          userIds: [authStub.user1.user.id],
        }),
      );
    });

    it('should understand relative date phrases', async () => {
      vitest.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));

      const result = await sut.askSearch(authStub.user1, { query: 'photos from last month' });

      expect(result.plan.filters).toEqual(
        expect.objectContaining({
          takenAfter: new Date('2026-04-01T00:00:00.000Z'),
          takenBefore: new Date('2026-04-30T23:59:59.999Z'),
        }),
      );
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          takenAfter: new Date('2026-04-01T00:00:00.000Z'),
          takenBefore: new Date('2026-04-30T23:59:59.999Z'),
        }),
      );
    });

    it('should understand open-ended year phrases', async () => {
      const result = await sut.askSearch(authStub.user1, { query: 'videos since 2020' });

      expect(result.plan.filters).toEqual(
        expect.objectContaining({
          takenAfter: new Date('2020-01-01T00:00:00.000Z'),
          takenBefore: undefined,
          type: 'VIDEO',
        }),
      );
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          takenAfter: new Date('2020-01-01T00:00:00.000Z'),
          takenBefore: undefined,
          type: 'VIDEO',
        }),
      );
    });

    it('should understand named month phrases', async () => {
      const result = await sut.askSearch(authStub.user1, { query: 'photos from April 2024' });

      expect(result.plan.filters).toEqual(
        expect.objectContaining({
          takenAfter: new Date('2024-04-01T00:00:00.000Z'),
          takenBefore: new Date('2024-04-30T23:59:59.999Z'),
        }),
      );
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          takenAfter: new Date('2024-04-01T00:00:00.000Z'),
          takenBefore: new Date('2024-04-30T23:59:59.999Z'),
        }),
      );
    });

    it('should understand open-ended named month phrases', async () => {
      const beforeResult = await sut.askSearch(authStub.user1, { query: 'photos before April 2024' });

      expect(beforeResult.plan.filters).toEqual(
        expect.objectContaining({
          takenAfter: undefined,
          takenBefore: new Date('2024-04-01T00:00:00.000Z'),
        }),
      );
      expect(mocks.search.searchSmart).toHaveBeenLastCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          takenAfter: undefined,
          takenBefore: new Date('2024-04-01T00:00:00.000Z'),
        }),
      );

      const afterResult = await sut.askSearch(authStub.user1, { query: 'photos after April 2024' });

      expect(afterResult.plan.filters).toEqual(
        expect.objectContaining({
          takenAfter: new Date('2024-04-01T00:00:00.000Z'),
          takenBefore: undefined,
        }),
      );
      expect(mocks.search.searchSmart).toHaveBeenLastCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          takenAfter: new Date('2024-04-01T00:00:00.000Z'),
          takenBefore: undefined,
        }),
      );

      const sinceResult = await sut.askSearch(authStub.user1, { query: 'photos since April 2024' });

      expect(sinceResult.plan.filters).toEqual(
        expect.objectContaining({
          takenAfter: new Date('2024-04-01T00:00:00.000Z'),
          takenBefore: undefined,
        }),
      );
    });

    it('should resolve people names into person filters when possible', async () => {
      const person = PersonFactory.create({ id: 'person-1', name: 'Alice', ownerId: authStub.user1.user.id });
      mocks.person.getByName.mockResolvedValue([person]);

      const result = await sut.askSearch(authStub.user1, { query: 'photos of Alice in Banff' });

      expect(result.warnings).toEqual([]);
      expect(result.plan.filters).toEqual(expect.objectContaining({ personIds: ['person-1'], city: 'Banff' }));
      expect(mocks.person.getByName).toHaveBeenCalledWith(authStub.user1.user.id, 'Alice', { withHidden: false });
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          personIds: ['person-1'],
          city: 'Banff',
        }),
      );
    });

    it('should not resolve people names for API keys without person read permission', async () => {
      const auth = AuthFactory.from(authStub.user1.user)
        .apiKey({ permissions: [Permission.AssetRead] })
        .build();

      const result = await sut.askSearch(auth, { query: 'photos of Alice in Banff' });

      expect(result.plan.filters).toEqual(expect.not.objectContaining({ personIds: expect.anything() }));
      expect(result.warnings).toEqual([
        'People names are searched semantically until Ask Search can resolve names to person IDs.',
      ]);
      expect(mocks.person.getByName).not.toHaveBeenCalled();
      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.not.objectContaining({
          personIds: expect.anything(),
        }),
      );
    });

    it('should resolve lowercase people names and warn when they cannot be resolved', async () => {
      const person = PersonFactory.create({ id: 'person-1', name: 'Alice', ownerId: authStub.user1.user.id });
      mocks.person.getByName.mockResolvedValueOnce([person]);

      const resolvedResult = await sut.askSearch(authStub.user1, { query: 'photos of alice in Banff' });

      expect(resolvedResult.warnings).toEqual([]);
      expect(resolvedResult.plan.filters).toEqual(expect.objectContaining({ personIds: ['person-1'] }));
      expect(mocks.person.getByName).toHaveBeenCalledWith(authStub.user1.user.id, 'alice', { withHidden: false });

      mocks.person.getByName.mockResolvedValueOnce([]);

      const fallbackResult = await sut.askSearch(authStub.user1, { query: 'photos of alice in Banff' });

      expect(fallbackResult.plan.filters).toEqual(expect.not.objectContaining({ personIds: expect.anything() }));
      expect(fallbackResult.warnings).toEqual([
        'People names are searched semantically until Ask Search can resolve names to person IDs.',
      ]);
    });

    it('should use OCR-backed metadata search for document-like queries', async () => {
      const result = await sut.askSearch(authStub.user1, { query: 'receipts from 2024' });

      expect(result.plan.mode).toBe('metadata');
      expect(result.plan.filters).toEqual(
        expect.objectContaining({
          ocr: 'receipt invoice total tax',
          takenAfter: new Date('2024-01-01T00:00:00.000Z'),
          takenBefore: new Date('2024-12-31T23:59:59.999Z'),
        }),
      );
      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          ocr: 'receipt invoice total tax',
          userIds: [authStub.user1.user.id],
        }),
      );
      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
    });

    it('should use metadata filename search for screenshots', async () => {
      const result = await sut.askSearch(authStub.user1, { query: 'screenshots from last year' });

      expect(result.plan.mode).toBe('metadata');
      expect(result.plan.filters).toEqual(
        expect.objectContaining({
          originalFileName: 'Screenshot',
          takenAfter: new Date(`${new Date().getUTCFullYear() - 1}-01-01T00:00:00.000Z`),
          takenBefore: new Date(`${new Date().getUTCFullYear() - 1}-12-31T23:59:59.999Z`),
        }),
      );
      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        { page: 1, size: 100 },
        expect.objectContaining({
          originalFileName: 'Screenshot',
          userIds: [authStub.user1.user.id],
        }),
      );
      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
    });

    it('should reject when Ask Search is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ localFeatures: { askSearch: { enabled: false, maxResults: 100 } } });

      await expect(sut.askSearch(authStub.user1, { query: 'dogs' })).rejects.toThrowError(
        new BadRequestException('Ask Search is not enabled'),
      );
    });
  });
});
