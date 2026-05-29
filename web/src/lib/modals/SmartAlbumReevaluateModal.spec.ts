import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import type { SmartAlbumReevaluateEstimateDto } from '@immich/sdk';
import SmartAlbumReevaluateModal from './SmartAlbumReevaluateModal.svelte';

describe('SmartAlbumReevaluateModal component', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  /**
   * Regression guard for the deferred-promise pattern.
   *
   * Pre-fix the modal stored `estimatePromise` as `$state(undefined)` and
   * only assigned it inside `onMount`. Svelte 5's `{#await undefined}`
   * immediately renders the `{:then}` branch — which, with both `estimate`
   * and `loadError` still undefined, briefly painted an empty `<ModalBody>`
   * before the spinner showed up.
   *
   * After the fix, the promise is created synchronously in the script body
   * (a deferred promise with a captured `resolve`). The fetch is kicked
   * off in `onMount`, but the markup awaits a real pending promise from
   * the very first render, so the `{#await}` enters the spinner branch on
   * frame 1.
   *
   * Verify: while the SDK estimate call is still pending, the loading copy
   * appears in the modal body and the empty-then branch never paints.
   */
  test('shows the spinner branch from the first render (no empty-body flash)', async () => {
    let resolveEstimate: ((value: SmartAlbumReevaluateEstimateDto) => void) | undefined;
    sdkMock.getSmartAlbumReevaluateEstimate.mockImplementation(
      () =>
        new Promise<SmartAlbumReevaluateEstimateDto>((resolve) => {
          resolveEstimate = resolve;
        }),
    );

    render(SmartAlbumReevaluateModal, {
      props: { onClose },
    });

    // Loading branch shows immediately — no "then with both undefined" flash.
    expect(await screen.findByText('admin.smart_albums_reevaluate_modal_loading')).toBeInTheDocument();
    // The eligible-assets dt is part of the then-branch and must NOT be rendered yet.
    expect(screen.queryByText('admin.smart_albums_reevaluate_modal_eligible_assets')).not.toBeInTheDocument();

    // Resolve the fetch and verify the then-branch then renders.
    resolveEstimate?.({ totalAssets: 42, withDescription: 42 });
    await waitFor(() => {
      expect(screen.getByText('admin.smart_albums_reevaluate_modal_eligible_assets')).toBeInTheDocument();
    });
  });

  /**
   * Cancel-on-unmount: aborting the fetch settles the deferred promise so
   * `{#await}` resolves cleanly instead of holding forever after teardown.
   */
  test('aborts the estimate fetch on unmount', async () => {
    let receivedSignal: AbortSignal | null | undefined;
    sdkMock.getSmartAlbumReevaluateEstimate.mockImplementation(
      (options) =>
        new Promise<SmartAlbumReevaluateEstimateDto>((_resolve, reject) => {
          receivedSignal = options?.signal;
          options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

    const { unmount } = render(SmartAlbumReevaluateModal, {
      props: { onClose },
    });

    await waitFor(() => {
      expect(receivedSignal).toBeDefined();
    });

    expect(receivedSignal?.aborted).toBe(false);
    unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });

  /**
   * Confirm path: after the estimate resolves, clicking Confirm calls
   * `triggerSmartAlbumReevaluate` and forwards the result to onClose.
   */
  test('triggers re-evaluation and closes with the result on confirm', async () => {
    sdkMock.getSmartAlbumReevaluateEstimate.mockResolvedValue({ totalAssets: 7, withDescription: 7 });
    sdkMock.triggerSmartAlbumReevaluate.mockResolvedValue({ queued: true });

    render(SmartAlbumReevaluateModal, {
      props: { onClose },
    });

    await waitFor(() => {
      expect(screen.getByText('admin.smart_albums_reevaluate_modal_eligible_assets')).toBeInTheDocument();
    });

    const confirm = screen.getByRole('button', { name: /admin\.smart_albums_reevaluate_modal_confirm/i });
    await fireEvent.click(confirm);

    await waitFor(() => {
      expect(sdkMock.triggerSmartAlbumReevaluate).toHaveBeenCalledWith({ smartAlbumReevaluateRequestDto: {} });
      expect(onClose).toHaveBeenCalledWith({ queued: true });
    });
  });

  /**
   * Failure path: load error is displayed and the confirm button is
   * disabled (so the user can't queue work against a stats panel that
   * never loaded).
   */
  test('shows the load-error message and disables confirm when the estimate fails', async () => {
    sdkMock.getSmartAlbumReevaluateEstimate.mockRejectedValue(new Error('boom'));

    render(SmartAlbumReevaluateModal, {
      props: { onClose },
    });

    expect(await screen.findByText('admin.smart_albums_reevaluate_modal_error')).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /admin\.smart_albums_reevaluate_modal_confirm/i });
    expect(confirm).toBeDisabled();
  });
});
