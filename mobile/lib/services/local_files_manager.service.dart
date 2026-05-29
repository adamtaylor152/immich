import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:logging/logging.dart';

final localFileManagerServiceProvider = Provider<LocalFilesManagerService>((ref) => const LocalFilesManagerService());

class LocalFilesManagerService {
  const LocalFilesManagerService();

  static final Logger _logger = Logger('LocalFilesManager');
  static const MethodChannel _channel = MethodChannel('file_trash');

  Future<bool> moveToTrash(List<String> mediaUrls) async {
    try {
      return await _channel.invokeMethod<bool>('moveToTrash', {'mediaUrls': mediaUrls}) ?? false;
    } catch (e, s) {
      _logger.warning('Error moving file to trash', e, s);
      return false;
    }
  }

  Future<bool> restoreFromTrash(String fileName, int type) async {
    try {
      return await _channel.invokeMethod<bool>('restoreFromTrash', {'fileName': fileName, 'type': type}) ?? false;
    } catch (e, s) {
      _logger.warning('Error restore file from trash', e, s);
      return false;
    }
  }

  Future<bool> restoreFromTrashById(String mediaId, int type) async {
    try {
      return await _channel.invokeMethod<bool>('restoreFromTrash', {'mediaId': mediaId, 'type': type}) ?? false;
    } catch (e, s) {
      _logger.warning('Error restore file from trash by Id', e, s);
      return false;
    }
  }

  Future<bool> requestManageMediaPermission() async {
    try {
      return await _channel.invokeMethod<bool>('requestManageMediaPermission') ?? false;
    } catch (e, s) {
      _logger.warning('Error requesting manage media permission', e, s);
      return false;
    }
  }

  Future<bool> hasManageMediaPermission() async {
    try {
      return await _channel.invokeMethod<bool>('hasManageMediaPermission') ?? false;
    } catch (e, s) {
      _logger.warning('Error requesting manage media permission state', e, s);
      return false;
    }
  }

  Future<bool> manageMediaPermission() async {
    try {
      return await _channel.invokeMethod<bool>('manageMediaPermission') ?? false;
    } catch (e, s) {
      _logger.warning('Error requesting manage media permission settings', e, s);
      return false;
    }
  }
}
