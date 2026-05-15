import { AssetTypeEnum, editAsset, getAssetEdits } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, waitFor } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import VideoEditorPanel from './VideoEditorPanel.svelte';

vi.mock('@immich/sdk', async () => {
  const sdk = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...sdk,
    editAsset: vi.fn(),
    getAssetEdits: vi.fn(),
    removeAssetEdits: vi.fn(),
  };
});

vi.mock('$lib/managers/event-manager.svelte', () => ({
  eventManager: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('$lib/stores/websocket', () => ({
  waitForWebsocketEvent: vi.fn().mockResolvedValue(undefined),
}));

const rect = (width: number, height: number): DOMRect => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: width,
  bottom: height,
  width,
  height,
  toJSON: () => ({}),
});

describe('VideoEditorPanel component', () => {
  const asset = assetFactory.build({
    type: AssetTypeEnum.Video,
    originalPath: '/upload/video.mp4',
    originalFileName: 'video.mp4',
    width: 1920,
    height: 1080,
    duration: 10_000,
  });

  beforeEach(() => {
    vi.mocked(getAssetEdits).mockResolvedValue({ assetId: asset.id, edits: [] });
    vi.mocked(editAsset).mockResolvedValue({ assetId: asset.id, edits: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the focused video editor tools', async () => {
    const { findByRole } = renderWithTooltips(VideoEditorPanel, { asset, onClose: vi.fn() });

    expect(await findByRole('button', { name: 'editor_video_auto' })).toBeInTheDocument();
    expect(await findByRole('button', { name: 'crop' })).toBeInTheDocument();
    expect(await findByRole('button', { name: 'filters' })).toBeInTheDocument();
    expect(await findByRole('button', { name: 'editor_video_trim' })).toBeInTheDocument();
  });

  it('uses preset crop controls and emits computed crop parameters', async () => {
    const { findByRole, getByRole, queryByText } = renderWithTooltips(VideoEditorPanel, { asset, onClose: vi.fn() });

    await fireEvent.click(await findByRole('button', { name: 'crop' }));
    expect(queryByText('Crop values')).not.toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: /9:16/ }));
    await fireEvent.click(getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(editAsset).toHaveBeenCalledWith({
        id: asset.id,
        assetEditsCreateDto: {
          edits: [
            {
              action: 'crop',
              parameters: { x: 656, y: 0, width: 608, height: 1080 },
            },
          ],
        },
      }),
    );
  });

  it('uses trim handles instead of time inputs', async () => {
    const { findByRole, getByLabelText, getByRole } = renderWithTooltips(VideoEditorPanel, { asset, onClose: vi.fn() });

    await fireEvent.click(await findByRole('button', { name: 'editor_video_trim' }));
    const endHandle = getByLabelText('editor_video_trim_end');
    vi.spyOn(endHandle, 'getBoundingClientRect').mockReturnValue(rect(200, 44));

    await fireEvent.pointerDown(endHandle, { clientX: 100, clientY: 22 });
    await fireEvent.click(getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(editAsset).toHaveBeenCalledWith({
        id: asset.id,
        assetEditsCreateDto: {
          edits: [{ action: 'trim', parameters: { startMs: 0, endMs: 5000 } }],
        },
      }),
    );
  });

  it('drags text overlays to normalized positions', async () => {
    const { container, findByRole, getByLabelText, getByRole } = renderWithTooltips(VideoEditorPanel, {
      asset,
      onClose: vi.fn(),
    });

    await fireEvent.click(await findByRole('button', { name: 'editor_video_text' }));
    await fireEvent.input(getByRole('textbox'), { target: { value: 'Hello' } });

    const preview = container.querySelector('.text-preview') as HTMLElement;
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue(rect(200, 100));

    await fireEvent.pointerDown(getByLabelText('editor_video_move_text'), { clientX: 160, clientY: 25 });
    await fireEvent.click(getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(editAsset).toHaveBeenCalledWith({
        id: asset.id,
        assetEditsCreateDto: {
          edits: [
            {
              action: 'textOverlay',
              parameters: {
                text: 'Hello',
                x: 0.8,
                y: 0.25,
                startMs: 0,
                endMs: 10_000,
                size: 0.06,
                color: '#ffffff',
              },
            },
          ],
        },
      }),
    );
  });
});
