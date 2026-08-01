import native_video_player

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  // Retains FileTrash channels per-engine so they can be released when the
  // engine is torn down. Keyed by `ObjectIdentifier(engine)` for engines
  // with a clean lifecycle (e.g. BackgroundWorker). The implicit Flutter
  // engine has no `FlutterEngine` reference exposed at registration time
  // and lives for the lifetime of the app, so it uses the nil key — a
  // single retained entry that never needs release.
  //
  // Thread-safety: accessed without a lock. Safe because the two callers
  // — `didInitializeImplicitFlutterEngine(_:)` and
  // `BackgroundWorker.run` — both invoke FlutterEngine setup on the main
  // thread per Flutter's engine lifecycle contract, as does
  // `cancelPlugins(with:)`. Matches the pre-refactor invariant; do not
  // call `registerPlugins` / `cancelPlugins` off the main thread without
  // adding a serial queue here.
  private static var fileTrashChannels: [ObjectIdentifier?: FlutterMethodChannel] = [:]

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
    AppDelegate.registerPlugins(with: engineBridge.pluginRegistry, messenger: messenger, engine: nil)
  }

  public static func registerPlugins(
    with registry: FlutterPluginRegistry,
    messenger: FlutterBinaryMessenger,
    engine: FlutterEngine? = nil
  ) {
    NativeSyncApiImpl.register(with: registry.registrar(forPlugin: NativeSyncApiImpl.name)!)
    PermissionApiSetup.setUp(binaryMessenger: messenger, api: PermissionApiImpl())
    LocalImageApiSetup.setUp(binaryMessenger: messenger, api: LocalImageApiImpl())
    RemoteImageApiSetup.setUp(binaryMessenger: messenger, api: RemoteImageApiImpl())
    BackgroundWorkerFgHostApiSetup.setUp(binaryMessenger: messenger, api: BackgroundWorkerApiImpl())
    ConnectivityApiSetup.setUp(binaryMessenger: messenger, api: ConnectivityApiImpl())
    NetworkApiSetup.setUp(binaryMessenger: messenger, api: NetworkApiImpl())
    registerFileTrashChannel(messenger: messenger, engine: engine)
  }

  public static func cancelPlugins(with engine: FlutterEngine) {
    (engine.valuePublished(byPlugin: NativeSyncApiImpl.name) as? NativeSyncApiImpl)?.detachFromEngine()
    // Release the FileTrash channel tied to this engine so it doesn't leak
    // one `FlutterMethodChannel` per background-task lifecycle. Clearing the
    // handler is belt-and-suspenders in case the channel is referenced
    // elsewhere; the dictionary entry removal is the actual fix.
    let key = ObjectIdentifier(engine)
    if let channel = fileTrashChannels.removeValue(forKey: key) {
      channel.setMethodCallHandler(nil)
    }
  }

  // Backs the Dart `MethodChannel('file_trash')` used by
  // `lib/services/local_files_manager.service.dart`.
  //
  // MANAGE_MEDIA permission and MediaStore-based trash are Android-only.
  // iOS users go through the PhotoKit lifecycle for deletes/restores via the
  // stock Photos UI, so every call here is a benign no-op that reports
  // false. Matches the upstream pigeon stub behavior (hard-coded false).
  private static func registerFileTrashChannel(messenger: FlutterBinaryMessenger, engine: FlutterEngine?) {
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
    let key: ObjectIdentifier? = engine.map(ObjectIdentifier.init)
    // If a channel was already registered for this engine (e.g. registerPlugins
    // is called twice), release the old handler before replacing.
    fileTrashChannels[key]?.setMethodCallHandler(nil)
    fileTrashChannels[key] = channel
  }
}
