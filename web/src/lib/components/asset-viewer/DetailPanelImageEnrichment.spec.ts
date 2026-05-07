import {
  AssetImageEnrichmentAction,
  AssetTypeEnum,
  getAssetImageEnrichment,
  getAssetInfo,
  isHttpError,
  Status,
  updateAssetImageEnrichment,
  type AssetImageEnrichmentResponseDto,
} from '@immich/sdk';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import DetailPanelImageEnrichment from './DetailPanelImageEnrichment.svelte';

vi.mock('@immich/sdk', async () => {
  const sdk = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...sdk,
    getAssetImageEnrichment: vi.fn(),
    getAssetInfo: vi.fn(),
    isHttpError: vi.fn(),
    updateAssetImageEnrichment: vi.fn(),
  };
});

const enrichmentFactory = (assetId: string, effectiveIsNsfw: boolean): AssetImageEnrichmentResponseDto => ({
  assetId,
  description: {
    status: Status.Missing,
    appliedDescription: false,
    appliedTags: false,
  },
  nsfwDetection: {
    status: Status.Success,
    effectiveIsNsfw,
    isNsfw: effectiveIsNsfw,
    score: effectiveIsNsfw ? 1 : 0,
    labels: {
      nsfw: effectiveIsNsfw ? 1 : 0,
      normal: effectiveIsNsfw ? 0 : 1,
    },
    appliedTags: false,
  },
});

describe('DetailPanelImageEnrichment', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('removes an asset from the current view when marking it NSFW hides it from the session', async () => {
    const asset = assetFactory.build({ type: AssetTypeEnum.Image });
    const onAssetSuppressed = vi.fn();
    const hiddenAssetError = { status: 400, data: { statusCode: 400 } };

    vi.mocked(getAssetImageEnrichment).mockResolvedValue(enrichmentFactory(asset.id, false));
    vi.mocked(updateAssetImageEnrichment).mockResolvedValue(enrichmentFactory(asset.id, true));
    vi.mocked(getAssetInfo).mockRejectedValue(hiddenAssetError);
    vi.mocked(isHttpError).mockImplementation((error) => error === hiddenAssetError);

    renderWithTooltips(DetailPanelImageEnrichment, {
      asset,
      isOwner: true,
      isAdmin: true,
      onAssetSuppressed,
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'mark_nsfw' }));

    await waitFor(() =>
      expect(updateAssetImageEnrichment).toHaveBeenCalledWith({
        id: asset.id,
        assetImageEnrichmentActionRequestDto: { action: AssetImageEnrichmentAction.MarkNsfw },
      }),
    );
    await waitFor(() => expect(getAssetInfo).toHaveBeenCalledWith({ id: asset.id }));
    expect(onAssetSuppressed).toHaveBeenCalledWith(asset);
  });
});
