import { BadRequestException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import { AssetMapOptions, AssetResponseDto, MapAsset, mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { mapPerson, PersonResponseDto } from 'src/dtos/person.dto';
import {
  AskSearchDto,
  AskSearchResponseDto,
  LargeAssetSearchDto,
  mapPlaces,
  MetadataSearchDto,
  PlacesResponseDto,
  RandomSearchDto,
  SearchPeopleDto,
  SearchPlacesDto,
  SearchResponseDto,
  SearchStatisticsResponseDto,
  SearchSuggestionRequestDto,
  SearchSuggestionType,
  SmartSearchDto,
  StatisticsSearchDto,
} from 'src/dtos/search.dto';
import { AssetOrder, AssetType, AssetVisibility, Permission } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { isGranted, requireElevatedPermission } from 'src/utils/access';
import { getMyPartnerIds } from 'src/utils/asset.util';
import { getHiddenContentQueryOptions, getPrivacyQueryOptions } from 'src/utils/hidden-content';
import { isSmartSearchEnabled } from 'src/utils/misc';
import { fromChecksum } from 'src/utils/request';

@Injectable()
export class SearchService extends BaseService {
  private embeddingCache = new LRUMap<string, string>(100);

  async askSearch(auth: AuthDto, dto: AskSearchDto): Promise<AskSearchResponseDto> {
    const { localFeatures } = await this.getConfig({ withCache: false });
    if (!localFeatures.askSearch.enabled) {
      throw new BadRequestException('Ask Search is not enabled');
    }

    const plan = await this.buildAskSearchPlan(auth, dto.query, {
      page: dto.page,
      size: Math.min(dto.size ?? localFeatures.askSearch.maxResults, localFeatures.askSearch.maxResults),
    });
    const results =
      plan.mode === 'smart'
        ? await this.searchSmart(auth, { ...plan.filters, query: plan.normalizedQuery, language: dto.language })
        : await this.searchMetadata(auth, plan.filters);

    return {
      query: dto.query,
      explanation: this.describeAskSearchPlan(plan),
      warnings: plan.warnings,
      plan: {
        mode: plan.mode,
        normalizedQuery: plan.normalizedQuery,
        filters: plan.filters,
      },
      results,
    };
  }

  async searchPerson(auth: AuthDto, dto: SearchPeopleDto): Promise<PersonResponseDto[]> {
    const people = await this.personRepository.getByName(auth.user.id, dto.name, {
      ...getHiddenContentQueryOptions(auth),
      withHidden: dto.withHidden,
    });
    return people.map((person) => mapPerson(person));
  }

  async searchPlaces(dto: SearchPlacesDto): Promise<PlacesResponseDto[]> {
    const places = await this.searchRepository.searchPlaces(dto.name);
    return places.map((place) => mapPlaces(place));
  }

  async getExploreData(auth: AuthDto) {
    const options = { ...getHiddenContentQueryOptions(auth), maxFields: 12, minAssetsPerField: 5 };

    const cities = await this.assetRepository.getAssetIdByCity(auth.user.id, options);
    const cityAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      cities.items.map(({ data }) => data),
      auth.user.id,
    );
    const cityItems = cityAssets.map((asset) => ({ value: asset.exifInfo!.city!, data: mapAsset(asset, { auth }) }));

    const recents = await this.assetRepository.getRecentlyCreatedAssetIds(auth.user.id, options);
    const recentAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      recents.items.map((item) => item.data),
      auth.user.id,
    );
    const recentItems = recentAssets.map((asset) => ({
      value: asset.createdAt.toISOString(),
      data: mapAsset(asset, { auth }),
    }));

    return [
      { fieldName: cities.fieldName, items: cityItems },
      { fieldName: recents.fieldName, items: recentItems },
    ];
  }

  async searchMetadata(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    const { suppressedOnly, ...searchDto } = dto;
    const privacyOptions = getPrivacyQueryOptions(auth, suppressedOnly);

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    let checksum: Buffer | undefined;
    if (dto.checksum) {
      // Supports SHA-1 (legacy) and SHA-256 (current) digests, both hex and base64.
      checksum = fromChecksum(dto.checksum);
    }

    let userIds: string[] | undefined;

    if (dto.albumIds && dto.albumIds.length > 0) {
      await this.requireAccess({ auth, ids: dto.albumIds, permission: Permission.AlbumRead });
    } else if (auth.sharedLink) {
      throw new BadRequestException('Shared link access is only allowed in combination with an albumIds filter');
    } else {
      userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    }

    const page = dto.page ?? 1;
    const size = dto.size || 250;
    const { hasNextPage, items } = await this.searchRepository.searchMetadata(
      { page, size },
      {
        ...searchDto,
        checksum,
        ...privacyOptions,
        visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
        userIds,
        viewingUserId: auth.user.id,
        orderDirection: dto.order ?? AssetOrder.Desc,
      },
    );

    return this.mapResponse(items, hasNextPage ? (page + 1).toString() : null, { auth });
  }

  async searchStatistics(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    const { suppressedOnly, ...searchDto } = dto;
    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    return await this.searchRepository.searchStatistics({
      ...searchDto,
      ...getPrivacyQueryOptions(auth, suppressedOnly),
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
  }

  async searchRandom(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    const { suppressedOnly, ...searchDto } = dto;

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const items = await this.searchRepository.searchRandom(dto.size || 250, {
      ...searchDto,
      ...getPrivacyQueryOptions(auth, suppressedOnly),
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchLargeAssets(auth: AuthDto, dto: LargeAssetSearchDto): Promise<AssetResponseDto[]> {
    const { suppressedOnly, ...searchDto } = dto;

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const items = await this.searchRepository.searchLargeAssets(dto.size || 250, {
      ...searchDto,
      ...getPrivacyQueryOptions(auth, suppressedOnly),
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchSmart(auth: AuthDto, dto: SmartSearchDto): Promise<SearchResponseDto> {
    const { suppressedOnly, ...searchDto } = dto;

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSmartSearchEnabled(machineLearning)) {
      throw new BadRequestException('Smart search is not enabled');
    }

    const userIds = this.getUserIdsToSearch(auth, dto.visibility);
    let embedding;
    if (dto.query) {
      const key = machineLearning.clip.modelName + dto.query + dto.language;
      embedding = this.embeddingCache.get(key);
      if (!embedding) {
        embedding = await this.machineLearningRepository.encodeText(dto.query, {
          modelName: machineLearning.clip.modelName,
          language: dto.language,
        });
        this.embeddingCache.set(key, embedding);
      }
    } else if (dto.queryAssetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.queryAssetId] });
      const getEmbeddingResponse = await this.searchRepository.getEmbedding(dto.queryAssetId);
      const assetEmbedding = getEmbeddingResponse?.embedding;
      if (!assetEmbedding) {
        throw new BadRequestException(`Asset ${dto.queryAssetId} has no embedding`);
      }
      embedding = assetEmbedding;
    } else {
      throw new BadRequestException('Either `query` or `queryAssetId` must be set');
    }
    const page = dto.page ?? 1;
    const size = dto.size || 100;
    const { hasNextPage, items } = await this.searchRepository.searchSmart(
      { page, size },
      {
        ...searchDto,
        ...getPrivacyQueryOptions(auth, suppressedOnly),
        userIds: await userIds,
        viewingUserId: auth.user.id,
        embedding,
        query: dto.query,
        visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      },
    );

    return this.mapResponse(items, hasNextPage ? (page + 1).toString() : null, { auth });
  }

  async getAssetsByCity(auth: AuthDto): Promise<AssetResponseDto[]> {
    const userIds = await this.getUserIdsToSearch(auth);
    const assets = await this.searchRepository.getAssetsByCity(userIds, getHiddenContentQueryOptions(auth));
    return assets.map((asset) => mapAsset(asset));
  }

  async getSearchSuggestions(auth: AuthDto, dto: SearchSuggestionRequestDto) {
    const userIds = await this.getUserIdsToSearch(auth);
    const suggestions = await this.getSuggestions(userIds, dto, auth);
    if (dto.includeNull) {
      suggestions.push(null);
    }
    return suggestions;
  }

  private getSuggestions(
    userIds: string[],
    dto: SearchSuggestionRequestDto,
    auth: AuthDto,
  ): Promise<Array<string | null>> {
    const nsfwOptions = getHiddenContentQueryOptions(auth);

    switch (dto.type) {
      case SearchSuggestionType.COUNTRY: {
        return this.searchRepository.getCountries(userIds, nsfwOptions);
      }
      case SearchSuggestionType.STATE: {
        return this.searchRepository.getStates(userIds, { country: dto.country, ...nsfwOptions });
      }
      case SearchSuggestionType.CITY: {
        return this.searchRepository.getCities(userIds, { country: dto.country, state: dto.state, ...nsfwOptions });
      }
      case SearchSuggestionType.CAMERA_MAKE: {
        return this.searchRepository.getCameraMakes(userIds, {
          model: dto.model,
          lensModel: dto.lensModel,
          ...nsfwOptions,
        });
      }
      case SearchSuggestionType.CAMERA_MODEL: {
        return this.searchRepository.getCameraModels(userIds, {
          make: dto.make,
          lensModel: dto.lensModel,
          ...nsfwOptions,
        });
      }
      case SearchSuggestionType.CAMERA_LENS_MODEL: {
        return this.searchRepository.getCameraLensModels(userIds, { make: dto.make, model: dto.model, ...nsfwOptions });
      }
      default: {
        return Promise.resolve([]);
      }
    }
  }

  private async getUserIdsToSearch(auth: AuthDto, visibility?: AssetVisibility): Promise<string[]> {
    // Locked assets are personal. Never include partner IDs, regardless of A's elevated session.
    if (visibility === AssetVisibility.Locked) {
      return [auth.user.id];
    }
    const partnerIds = await getMyPartnerIds({
      userId: auth.user.id,
      repository: this.partnerRepository,
      timelineEnabled: true,
    });
    return [auth.user.id, ...partnerIds];
  }

  private mapResponse(assets: MapAsset[], nextPage: string | null, options: AssetMapOptions): SearchResponseDto {
    return {
      albums: { total: 0, count: 0, items: [], facets: [] },
      assets: {
        total: assets.length,
        count: assets.length,
        items: assets.map((asset) => mapAsset(asset, options)),
        facets: [],
        nextPage,
      },
    };
  }

  private async buildAskSearchPlan(auth: AuthDto, query: string, pagination: { page?: number; size: number }) {
    const normalizedQuery = query.trim().replaceAll(/\s+/g, ' ');
    const lower = normalizedQuery.toLowerCase();
    const filters: MetadataSearchDto = { page: pagination.page ?? 1, size: pagination.size, withExif: true };
    const warnings: string[] = [];
    let mode: 'smart' | 'metadata' = 'smart';

    const relativeDateRange = this.getAskSearchRelativeDateRange(lower);
    if (relativeDateRange) {
      filters.takenAfter = relativeDateRange.after;
      filters.takenBefore = relativeDateRange.before;
    }

    const year = lower.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
    if (year && !relativeDateRange) {
      filters.takenAfter = new Date(`${year}-01-01T00:00:00.000Z`);
      filters.takenBefore = new Date(`${year}-12-31T23:59:59.999Z`);
    }

    if (/\blast summer\b/.test(lower) && !relativeDateRange) {
      const lastYear = new Date().getUTCFullYear() - 1;
      filters.takenAfter = new Date(`${lastYear}-06-01T00:00:00.000Z`);
      filters.takenBefore = new Date(`${lastYear}-08-31T23:59:59.999Z`);
    }

    const monthRange = this.getAskSearchMonthRange(lower);
    const openEndedMonthRange = this.getAskSearchOpenEndedMonthRange(lower);
    if (openEndedMonthRange && !relativeDateRange) {
      filters.takenAfter = openEndedMonthRange.after;
      filters.takenBefore = openEndedMonthRange.before;
    } else if (monthRange && !relativeDateRange) {
      filters.takenAfter = monthRange.after;
      filters.takenBefore = monthRange.before;
    }

    const afterYear = lower.match(/\b(?:after|since)\s+(19\d{2}|20\d{2})\b/)?.[1];
    if (afterYear) {
      filters.takenAfter = new Date(`${afterYear}-01-01T00:00:00.000Z`);
      filters.takenBefore = undefined;
    }

    const beforeYear = lower.match(/\bbefore\s+(19\d{2}|20\d{2})\b/)?.[1];
    if (beforeYear) {
      filters.takenAfter = undefined;
      filters.takenBefore = new Date(`${beforeYear}-01-01T00:00:00.000Z`);
    }

    if (/\b(favorites?|starred)\b/.test(lower)) {
      filters.isFavorite = true;
    }

    if (/\b(videos?|movies?)\b/.test(lower)) {
      filters.type = AssetType.Video;
    } else if (/\b(photos?|pictures?|images?)\b/.test(lower)) {
      filters.type = AssetType.Image;
    }

    const locationMatch = lower.match(
      /\b(?:in|near|around|at)\s+([a-z][a-z\s.'-]{2,}?)(?=\s+(?:last|this|from|during|with|of|in)\b|$)/,
    );
    if (locationMatch?.[1]) {
      const phrase = locationMatch[1].trim();
      // Possessive / generic referents ("my hometown", "the beach", "our place")
      // are not real city names. Forcing them through a strict city filter just
      // returns zero results with no signal to the user. Skip and warn instead.
      const firstWord = phrase.split(/\s+/, 1)[0];
      const LOCATION_STOP_WORDS = new Set(['my', 'the', 'our', 'a', 'an', 'this', 'that', 'some', 'any']);
      if (LOCATION_STOP_WORDS.has(firstWord)) {
        warnings.push(`Couldn't resolve "${phrase}" to a known location — showing results without a location filter.`);
      } else {
        filters.city = this.toTitleCase(phrase);
      }
    }

    if (/\b(receipts?|invoices?)\b/.test(lower)) {
      mode = 'metadata';
      filters.ocr = 'receipt invoice total tax';
    } else if (/\bscreenshots?\b/.test(lower)) {
      mode = 'metadata';
      filters.originalFileName = 'Screenshot';
    } else if (/\b(documents?|paperwork|forms?)\b/.test(lower)) {
      mode = 'metadata';
      filters.ocr = 'document form';
    } else if (/\b(ids?|passports?|license|medical|legal)\b/.test(lower)) {
      mode = 'metadata';
      filters.ocr = lower;
      warnings.push('Document categories are approximated with OCR until Document Intelligence is enabled.');
    }

    const personIds = await this.resolveAskSearchPeople(auth, normalizedQuery);
    if (personIds.length > 0) {
      filters.personIds = personIds;
    } else if (this.hasAskSearchPeoplePhrase(normalizedQuery)) {
      warnings.push('People names are searched semantically until Ask Search can resolve names to person IDs.');
    }

    return { mode, normalizedQuery, filters, warnings };
  }

  private describeAskSearchPlan(plan: Awaited<ReturnType<SearchService['buildAskSearchPlan']>>): string {
    const filters = Object.keys(plan.filters).filter((key) => !['page', 'size', 'withExif'].includes(key));
    const filterText = filters.length > 0 ? ` with ${filters.join(', ')} filters` : '';
    return plan.mode === 'smart'
      ? `Used local smart search${filterText}.`
      : `Used metadata and OCR search${filterText}.`;
  }

  private toTitleCase(value: string): string {
    return value
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private getAskSearchRelativeDateRange(query: string): { after: Date; before: Date } | null {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const endOfDay = (date: Date) =>
      new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

    if (/\btoday\b/.test(query)) {
      return { after: today, before: endOfDay(today) };
    }

    if (/\byesterday\b/.test(query)) {
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      return { after: yesterday, before: endOfDay(yesterday) };
    }

    if (/\bthis week\b/.test(query)) {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - start.getUTCDay());
      return { after: start, before: endOfDay(today) };
    }

    if (/\blast week\b/.test(query)) {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 7);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      return { after: start, before: endOfDay(end) };
    }

    if (/\bthis month\b/.test(query)) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { after: start, before: endOfDay(today) };
    }

    if (/\blast month\b/.test(query)) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { after: start, before: endOfDay(end) };
    }

    if (/\bthis year\b/.test(query)) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      return { after: start, before: endOfDay(today) };
    }

    if (/\blast year\b/.test(query)) {
      const year = today.getUTCFullYear() - 1;
      return {
        after: new Date(`${year}-01-01T00:00:00.000Z`),
        before: new Date(`${year}-12-31T23:59:59.999Z`),
      };
    }

    return null;
  }

  private getAskSearchMonthRange(query: string): { after: Date; before: Date } | null {
    const monthNames = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ];
    const monthPattern = monthNames.join('|');
    const match = query.match(new RegExp(String.raw`\b(${monthPattern})\b(?:\s+(19\d{2}|20\d{2}))?`));
    if (!match) {
      return null;
    }

    const now = new Date();
    const month = monthNames.indexOf(match[1]);
    const year = match[2] ? Number(match[2]) : now.getUTCFullYear();
    const after = new Date(Date.UTC(year, month, 1));
    const before = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    return { after, before };
  }

  private getAskSearchOpenEndedMonthRange(query: string): { after?: Date; before?: Date } | null {
    const monthNames = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ];
    const monthPattern = monthNames.join('|');
    const match = query.match(new RegExp(String.raw`\b(before|after|since)\s+(${monthPattern})\s+(19\d{2}|20\d{2})\b`));
    if (!match) {
      return null;
    }

    const month = monthNames.indexOf(match[2]);
    const year = Number(match[3]);
    const startOfMonth = new Date(Date.UTC(year, month, 1));

    return match[1] === 'before' ? { before: startOfMonth } : { after: startOfMonth };
  }

  private hasAskSearchPeoplePhrase(query: string) {
    return /\b(?:with|of)\s+[A-Za-z][\w'-]*/.test(query);
  }

  private canResolveAskSearchPeople(auth: AuthDto) {
    return !auth.apiKey || isGranted({ requested: [Permission.PersonRead], current: auth.apiKey.permissions });
  }

  private async resolveAskSearchPeople(auth: AuthDto, query: string): Promise<string[]> {
    if (!this.canResolveAskSearchPeople(auth)) {
      return [];
    }

    const match = query.match(
      /\b(?:with|of)\s+([A-Za-z][\w'-]*(?:\s+(?:and\s+)?[A-Za-z][\w'-]*)*?)(?=\s+(?:in|near|around|at|last|this|from|during|before|after|since)\b|$)/,
    );
    if (!match?.[1]) {
      return [];
    }

    const names = match[1]
      .split(/\s+(?:and|&)\s+|,\s*/)
      .map((name) => name.trim())
      .filter(Boolean);
    const people = await Promise.all(
      names.map(async (name) => {
        const matches = await this.personRepository.getByName(auth.user.id, name, {
          ...getHiddenContentQueryOptions(auth),
          withHidden: false,
        });
        return matches.find((person) => person.name.toLowerCase() === name.toLowerCase()) ?? matches[0];
      }),
    );

    return people.flatMap((person) => (person ? [person.personGroupId] : []));
  }
}
