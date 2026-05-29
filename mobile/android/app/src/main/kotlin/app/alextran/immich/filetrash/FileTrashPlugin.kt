package app.alextran.immich.filetrash

import android.app.Activity
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.Settings
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.net.toUri
import app.alextran.immich.core.ImmichPlugin
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.MethodChannel.Result
import io.flutter.plugin.common.PluginRegistry

/**
 * Plugin that backs the Dart `MethodChannel('file_trash')` used by
 * `mobile/lib/services/local_files_manager.service.dart`.
 *
 * Replaces the deleted pigeon-based PermissionApi / MediaTrashDelegate flow with a
 * MethodChannel implementation matching the contract the Dart code expects.
 */
class FileTrashPlugin :
  ImmichPlugin(),
  MethodChannel.MethodCallHandler,
  ActivityAware,
  PluginRegistry.ActivityResultListener {

  private var channel: MethodChannel? = null
  private var context: Context? = null
  private var activityBinding: ActivityPluginBinding? = null
  private var pendingResult: Result? = null
  private val permissionRequestCode = 1001
  private val trashRequestCode = 1002

  override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
    super.onAttachedToEngine(binding)
    context = binding.applicationContext
    channel = MethodChannel(binding.binaryMessenger, CHANNEL_NAME)
    channel?.setMethodCallHandler(this)
  }

  override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
    super.onDetachedFromEngine(binding)
    channel?.setMethodCallHandler(null)
    channel = null
    context = null
  }

  override fun onAttachedToActivity(binding: ActivityPluginBinding) {
    activityBinding = binding
    binding.addActivityResultListener(this)
  }

  override fun onDetachedFromActivityForConfigChanges() {
    activityBinding?.removeActivityResultListener(this)
    activityBinding = null
  }

  override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
    activityBinding = binding
    binding.addActivityResultListener(this)
  }

  override fun onDetachedFromActivity() {
    failPending()
    activityBinding?.removeActivityResultListener(this)
    activityBinding = null
  }

  override fun onMethodCall(call: MethodCall, result: Result) {
    if (context == null) {
      result.error("NO_CONTEXT", "Plugin not attached to engine", null)
      return
    }

    when (call.method) {
      "moveToTrash" -> handleMoveToTrash(call, result)
      "restoreFromTrash" -> handleRestoreFromTrash(call, result)
      "requestManageMediaPermission" -> handleRequestManageMediaPermission(result)
      "hasManageMediaPermission" -> result.success(hasManageMediaPermission())
      "manageMediaPermission" -> handleManageMediaPermission(result)
      else -> result.notImplemented()
    }
  }

  private fun handleMoveToTrash(call: MethodCall, result: Result) {
    val mediaUrls = call.argument<List<String>>("mediaUrls")
    if (mediaUrls.isNullOrEmpty()) {
      result.error("INVALID_ARGS", "The mediaUrls is not specified.", null)
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || !hasManageMediaPermission()) {
      result.error("PERMISSION_DENIED", "Media permission required", null)
      return
    }
    moveToTrash(mediaUrls, result)
  }

  private fun handleRestoreFromTrash(call: MethodCall, result: Result) {
    val mediaId = call.argument<String>("mediaId")
    val fileName = call.argument<String>("fileName")
    val type = call.argument<Int>("type")
    if (type == null || (mediaId == null && fileName == null)) {
      result.error("INVALID_ARGS", "restoreFromTrash requires mediaId or fileName plus type", null)
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || !hasManageMediaPermission()) {
      result.error("PERMISSION_DENIED", "Media permission required", null)
      return
    }
    if (mediaId != null) {
      restoreFromTrashById(mediaId, type, result)
    } else {
      restoreFromTrashByName(fileName!!, type, result)
    }
  }

  private fun handleRequestManageMediaPermission(result: Result) {
    if (hasManageMediaPermission()) {
      result.success(true)
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      result.success(false)
      return
    }
    openManageMediaSettings(result)
  }

  private fun handleManageMediaPermission(result: Result) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      result.success(false)
      return
    }
    openManageMediaSettings(result)
  }

  private fun hasManageMediaPermission(): Boolean {
    val ctx = context ?: return false
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      MediaStore.canManageMedia(ctx)
    } else {
      false
    }
  }

  private fun openManageMediaSettings(result: Result) {
    val activity = activityBinding?.activity
    if (activity == null) {
      result.error("NO_ACTIVITY", "Activity not available", null)
      return
    }

    val intent = Intent(Settings.ACTION_REQUEST_MANAGE_MEDIA).apply {
      data = "package:${activity.packageName}".toUri()
    }
    pendingResult = result
    try {
      activity.startActivityForResult(intent, permissionRequestCode)
    } catch (e: Exception) {
      pendingResult = null
      Log.e(TAG, "Failed to launch MANAGE_MEDIA settings", e)
      result.error("ACTIVITY_LAUNCH_FAILED", "Failed to launch MANAGE_MEDIA settings", e.toString())
    }
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun moveToTrash(mediaUrls: List<String>, result: Result) {
    val uris = mediaUrls.mapNotNull {
      try {
        it.toUri()
      } catch (e: Exception) {
        null
      }
    }
    if (uris.isEmpty()) {
      result.error("INVALID_ARGS", "No valid URIs provided", null)
      return
    }
    toggleTrash(uris, true, result)
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun restoreFromTrashByName(fileName: String, type: Int, result: Result) {
    val uri = getTrashedFileUriByName(fileName, type)
    if (uri == null) {
      result.error("TRASH_NOT_FOUND", "Trashed file not found: $fileName", null)
      return
    }
    toggleTrash(listOf(uri), false, result)
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun restoreFromTrashById(mediaId: String, type: Int, result: Result) {
    val id = mediaId.toLongOrNull()
    if (id == null) {
      result.error("INVALID_ID", "The file id is not a valid number: $mediaId", null)
      return
    }
    if (!isInTrash(id)) {
      result.error("TRASH_NOT_FOUND", "Item with id=$id not found in trash", null)
      return
    }
    val uri = ContentUris.withAppendedId(contentUriForType(type), id)
    toggleTrash(listOf(uri), false, result)
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun toggleTrash(uris: List<Uri>, isTrashed: Boolean, result: Result) {
    val activity = activityBinding?.activity
    val resolver = context?.contentResolver
    if (activity == null || resolver == null) {
      result.error("TRASH_ERROR", "Activity or ContentResolver not available", null)
      return
    }

    try {
      val pendingIntent = MediaStore.createTrashRequest(resolver, uris, isTrashed)
      pendingResult = result
      activity.startIntentSenderForResult(
        pendingIntent.intentSender,
        trashRequestCode,
        null,
        0,
        0,
        0,
      )
    } catch (e: Exception) {
      pendingResult = null
      Log.e(TAG, "Error creating or starting trash request", e)
      result.error("TRASH_ERROR", "Error creating or starting trash request", e.toString())
    }
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun isInTrash(id: Long): Boolean {
    val resolver = context?.contentResolver ?: return false
    val queryUri = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
    val args = Bundle().apply {
      putString(ContentResolver.QUERY_ARG_SQL_SELECTION, "${MediaStore.Files.FileColumns._ID}=?")
      putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, arrayOf(id.toString()))
      putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY)
      putInt(ContentResolver.QUERY_ARG_LIMIT, 1)
    }
    return resolver.query(queryUri, arrayOf(MediaStore.Files.FileColumns._ID), args, null)
      ?.use { it.moveToFirst() } == true
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun getTrashedFileUriByName(fileName: String, type: Int): Uri? {
    val resolver = context?.contentResolver ?: return null
    val queryUri = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
    val projection = arrayOf(MediaStore.Files.FileColumns._ID)
    val args = Bundle().apply {
      putString(ContentResolver.QUERY_ARG_SQL_SELECTION, "${MediaStore.Files.FileColumns.DISPLAY_NAME} = ?")
      putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, arrayOf(fileName))
      putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY)
    }
    resolver.query(queryUri, projection, args, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID))
        return ContentUris.withAppendedId(contentUriForType(type), id)
      }
    }
    return null
  }

  private fun contentUriForType(type: Int): Uri =
    when (type) {
      // Same order as AssetType from Dart.
      1 -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      2 -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
      3 -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
      else -> MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
    }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
    when (requestCode) {
      permissionRequestCode -> {
        val callback = pendingResult
        pendingResult = null
        callback?.success(hasManageMediaPermission())
        return true
      }
      trashRequestCode -> {
        val callback = pendingResult
        pendingResult = null
        callback?.success(resultCode == Activity.RESULT_OK)
        return true
      }
    }
    return false
  }

  private fun failPending() {
    val callback = pendingResult ?: return
    pendingResult = null
    callback.error("ACTIVITY_DETACHED", "Activity detached before result", null)
  }

  companion object {
    const val CHANNEL_NAME = "file_trash"
    private const val TAG = "FileTrashPlugin"
  }
}
