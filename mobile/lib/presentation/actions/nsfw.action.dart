import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:immich_mobile/repositories/asset_api.repository.dart';
import 'package:immich_mobile/services/action.service.dart';
import 'package:immich_mobile/services/toast.service.dart';
import 'package:immich_mobile/utils/error_handler.dart';

final _stateProvider = Provider.family.autoDispose<List<String>?, ActionSource>((ref, source) {
  final assets = ref.watch(ownedAssetsActionProvider(source));
  if (assets.isEmpty) {
    return null;
  }

  return assets.map((asset) => asset.id).toList(growable: false);
});

class MarkNsfwAction extends AssetActionBuilder {
  const MarkNsfwAction({required super.source});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    if (ref.watch(_stateProvider(source).select((assetIds) => assetIds == null))) {
      return null;
    }

    return .new(
      icon: Icons.visibility_off_outlined,
      label: context.t.mark_nsfw,
      onAction: () => _markNsfw(context, ref),
    );
  }

  Future<void> _markNsfw(BuildContext context, WidgetRef ref) async {
    final assetIds = ref.read(_stateProvider(source));
    if (assetIds == null) {
      return;
    }

    final actionService = ref.read(actionServiceProvider);
    final toastService = ref.read(toastServiceProvider);
    final clearSelection = ref.read(clearSelectionProvider(source));
    final errorMessage = context.t.scaffold_body_error_occurred;

    try {
      final result = await actionService.markNsfw(assetIds);
      if (!context.mounted) {
        return;
      }

      // Three-way toast: full success, partial failure, or full failure.
      // Mirrors the web behavior in `MarkNsfwAction.svelte` so users see when
      // some assets in the selection failed to update while others succeeded.
      _showEnrichmentToast(
        toastService,
        result,
        success: context.t.mark_nsfw_action_prompt(count: result.succeeded.length),
        partial: context.t.mark_nsfw_action_partial(
          succeeded: result.succeeded.length,
          total: result.total,
          failed: result.failed.length,
        ),
        error: errorMessage,
      );
      if (result.succeeded.isNotEmpty) {
        clearSelection();
      }
    } catch (error, stack) {
      handleError(error, stack: stack, description: "Failed to mark assets as NSFW");
    }
  }
}

class MarkSafeAction extends AssetActionBuilder {
  const MarkSafeAction({required super.source});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    if (ref.watch(_stateProvider(source).select((assetIds) => assetIds == null))) {
      return null;
    }

    return .new(icon: Icons.visibility_outlined, label: context.t.mark_safe, onAction: () => _markSafe(context, ref));
  }

  Future<void> _markSafe(BuildContext context, WidgetRef ref) async {
    final assetIds = ref.read(_stateProvider(source));
    if (assetIds == null) {
      return;
    }

    final actionService = ref.read(actionServiceProvider);
    final toastService = ref.read(toastServiceProvider);
    final clearSelection = ref.read(clearSelectionProvider(source));
    final errorMessage = context.t.scaffold_body_error_occurred;

    try {
      final result = await actionService.markSafe(assetIds);
      if (!context.mounted) {
        return;
      }

      _showEnrichmentToast(
        toastService,
        result,
        success: context.t.mark_safe_action_prompt(count: result.succeeded.length),
        partial: context.t.mark_safe_action_partial(
          succeeded: result.succeeded.length,
          total: result.total,
          failed: result.failed.length,
        ),
        error: errorMessage,
      );
      if (result.succeeded.isNotEmpty) {
        clearSelection();
      }
    } catch (error, stack) {
      handleError(error, stack: stack, description: "Failed to mark assets as safe");
    }
  }
}

void _showEnrichmentToast(
  ToastService toastService,
  AssetEnrichmentResult result, {
  required String success,
  required String partial,
  required String error,
}) {
  if (result.allSucceeded) {
    toastService.success(success);
  } else if (result.succeeded.isNotEmpty) {
    toastService.info(partial);
  } else {
    toastService.error(error);
  }
}
