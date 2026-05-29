import native_video_player

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  // Retains FileTrash channels across the lifetime of the engine.
  private static var fileTrashChannels: [FlutterMethodChannel] = []

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Required for flutter_local_notification
    if #available(iOS 10.0, *) {
      UNUserNotificationCenter.current().delegate = self as UNUserNotificationCenterDelegate
    }

    SwiftNativeVideoPlayerPlugin.cookieStorage = URLSessionManager.cookieStorage
    URLSessionManager.patchBackgroundDownloader()
    BackgroundWorkerApiImpl.registerBackgroundWorkers()

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let messenger = engineBridge.applicationRegistrar.messenger()
    AppDelegate.registerPlugins(with: engineBridge.pluginRegistry, messenger: messenger)
  }

  public static func registerPlugins(with registry: FlutterPluginRegistry, messenger: FlutterBinaryMessenger) {
    NativeSyncApiImpl.register(with: registry.registrar(forPlugin: NativeSyncApiImpl.name)!)
    LocalImageApiSetup.setUp(binaryMessenger: messenger, api: LocalImageApiImpl())
    RemoteImageApiSetup.setUp(binaryMessenger: messenger, api: RemoteImageApiImpl())
    BackgroundWorkerFgHostApiSetup.setUp(binaryMessenger: messenger, api: BackgroundWorkerApiImpl())
    ConnectivityApiSetup.setUp(binaryMessenger: messenger, api: ConnectivityApiImpl())
    NetworkApiSetup.setUp(binaryMessenger: messenger, api: NetworkApiImpl())
    registerFileTrashChannel(messenger: messenger)
  }

  public static func cancelPlugins(with engine: FlutterEngine) {
    (engine.valuePublished(byPlugin: NativeSyncApiImpl.name) as? NativeSyncApiImpl)?.detachFromEngine()
  }

  // Backs the Dart `MethodChannel('file_trash')` used by
  // `lib/services/local_files_manager.service.dart`.
  //
  // MANAGE_MEDIA permission and MediaStore-based trash are Android-only.
  // iOS users go through the PhotoKit lifecycle for deletes/restores via the
  // stock Photos UI, so every call here is a benign no-op that reports
  // false. Matches the upstream pigeon stub behavior (hard-coded false).
  private static func registerFileTrashChannel(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: "file_trash", binaryMessenger: messenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "moveToTrash",
           "restoreFromTrash",
           "requestManageMediaPermission",
           "hasManageMediaPermission",
           "manageMediaPermission":
        result(false)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    fileTrashChannels.append(channel)
  }
}
