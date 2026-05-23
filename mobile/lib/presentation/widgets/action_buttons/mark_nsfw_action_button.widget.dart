import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/base_action_button.widget.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';

bool _hasOwnedRemoteAssets(WidgetRef ref, ActionSource source) {
  if (source != ActionSource.timeline) {
    return true;
  }

  final ownerId = ref.watch(currentUserProvider.select((user) => user?.id));
  if (ownerId == null) {
    return false;
  }

  final selectedAssets = ref.watch(multiSelectProvider.select((state) => state.selectedAssets));
  return selectedAssets.whereType<RemoteAsset>().any((asset) => asset.ownerId == ownerId);
}

Future<void> performMarkNsfwAction(BuildContext context, WidgetRef ref, {required ActionSource source}) async {
  if (!context.mounted) {
    return;
  }

  final result = await ref.read(actionProvider.notifier).markNsfw(source);
  if (result.success) {
    ref.read(multiSelectProvider.notifier).reset();
  }

  final successMessage = 'mark_nsfw_action_prompt'.t(context: context, args: {'count': result.count.toString()});

  if (context.mounted) {
    ImmichToast.show(
      context: context,
      msg: result.success ? successMessage : 'scaffold_body_error_occurred'.t(context: context),
      gravity: ToastGravity.BOTTOM,
      toastType: result.success ? ToastType.success : ToastType.error,
    );
  }
}

class MarkNsfwActionButton extends ConsumerWidget {
  final ActionSource source;
  final bool iconOnly;
  final bool menuItem;

  const MarkNsfwActionButton({super.key, required this.source, this.iconOnly = false, this.menuItem = false});

  Future<void> _onTap(BuildContext context, WidgetRef ref) async {
    await performMarkNsfwAction(context, ref, source: source);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!_hasOwnedRemoteAssets(ref, source)) {
      return const SizedBox.shrink();
    }

    return BaseActionButton(
      maxWidth: 115.0,
      iconData: Icons.visibility_off_outlined,
      label: "mark_nsfw".t(context: context),
      iconOnly: iconOnly,
      menuItem: menuItem,
      onPressed: () => _onTap(context, ref),
    );
  }
}

Future<void> performMarkSafeAction(BuildContext context, WidgetRef ref, {required ActionSource source}) async {
  if (!context.mounted) {
    return;
  }

  final result = await ref.read(actionProvider.notifier).markSafe(source);
  if (result.success) {
    ref.read(multiSelectProvider.notifier).reset();
  }

  final successMessage = 'mark_safe_action_prompt'.t(context: context, args: {'count': result.count.toString()});

  if (context.mounted) {
    ImmichToast.show(
      context: context,
      msg: result.success ? successMessage : 'scaffold_body_error_occurred'.t(context: context),
      gravity: ToastGravity.BOTTOM,
      toastType: result.success ? ToastType.success : ToastType.error,
    );
  }
}

class MarkSafeActionButton extends ConsumerWidget {
  final ActionSource source;
  final bool iconOnly;
  final bool menuItem;

  const MarkSafeActionButton({super.key, required this.source, this.iconOnly = false, this.menuItem = false});

  Future<void> _onTap(BuildContext context, WidgetRef ref) async {
    await performMarkSafeAction(context, ref, source: source);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!_hasOwnedRemoteAssets(ref, source)) {
      return const SizedBox.shrink();
    }

    return BaseActionButton(
      maxWidth: 115.0,
      iconData: Icons.visibility_outlined,
      label: "mark_safe".t(context: context),
      iconOnly: iconOnly,
      menuItem: menuItem,
      onPressed: () => _onTap(context, ref),
    );
  }
}
