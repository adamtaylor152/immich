import BackgroundTasks

class BackgroundWorkerApiImpl: BackgroundWorkerFgHostApi {

  func enable() throws {
    BackgroundWorkerApiImpl.scheduleRefreshWorker()
    BackgroundWorkerApiImpl.scheduleProcessingWorker()
    FileLogger.log("BackgroundWorkerApiImpl:enable Background worker scheduled")
  }
  
  func configure(settings: BackgroundWorkerSettings) throws {
    // Android only
  }
  
  func saveNotificationMessage(title: String, body: String) throws {
    // Android only
  }
  
  func disable() throws {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: BackgroundWorkerApiImpl.refreshTaskID);
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: BackgroundWorkerApiImpl.processingTaskID);
    FileLogger.log("BackgroundWorkerApiImpl:disableUploadWorker Disabled background workers")
  }
  
  private static let refreshTaskID = "app.alextran.immich.background.refreshUpload"
  private static let processingTaskID = "app.alextran.immich.background.processingUpload"
  private static let taskSemaphore = DispatchSemaphore(value: 1)

  public static func registerBackgroundWorkers() {
      BGTaskScheduler.shared.register(
          forTaskWithIdentifier: processingTaskID, using: nil) { task in
          if task is BGProcessingTask {
            FileLogger.log("BackgroundWorkerApiImpl:BGProcessingTask Background Processing task received")
            handleBackgroundProcessing(task: task as! BGProcessingTask)
          }
      }

      BGTaskScheduler.shared.register(
          forTaskWithIdentifier: refreshTaskID, using: nil) { task in
          if task is BGAppRefreshTask {
            FileLogger.log("BackgroundWorkerApiImpl:BGAppRefreshTask Background Refresh task received")
            handleBackgroundRefresh(task: task as! BGAppRefreshTask)
          }
      }
    FileLogger.log("BackgroundWorkerApiImpl:registerBackgroundWorkers Background workers registered")
  }
  
  private static func scheduleRefreshWorker() {
    let backgroundRefresh = BGAppRefreshTaskRequest(identifier: refreshTaskID)
      backgroundRefresh.earliestBeginDate = Date(timeIntervalSinceNow: 5 * 60) // 5 mins

      do {
          try BGTaskScheduler.shared.submit(backgroundRefresh)
          FileLogger.log("BackgroundWorkerApiImpl:scheduleRefreshWorker Scheduled Refresh task")
      } catch {
          FileLogger.log("BackgroundWorkerApiImpl:scheduleRefreshWorker Could not schedule the refresh upload task \(error.localizedDescription)")
      }
  }

  private static func scheduleProcessingWorker() {
    let backgroundProcessing = BGProcessingTaskRequest(identifier: processingTaskID)
    
    backgroundProcessing.requiresNetworkConnectivity = true
    backgroundProcessing.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 mins
    
    do {
        try BGTaskScheduler.shared.submit(backgroundProcessing)
        FileLogger.log("BackgroundWorkerApiImpl:scheduleProcessingWorker Scheduled Processing task")
    } catch {
        FileLogger.log("BackgroundWorkerApiImpl:scheduleProcessingWorker Could not schedule the processing upload task \(error.localizedDescription)")
    }
  }
  
  private static func handleBackgroundRefresh(task: BGAppRefreshTask) {
    FileLogger.log("BackgroundWorkerApiImpl:handleBackgroundRefresh Entered, re-queuing next refresh task")
    scheduleRefreshWorker()
    // If another task is running, cede the background time back to the OS
    if taskSemaphore.wait(timeout: .now()) == .success {
      FileLogger.log("BackgroundWorkerApiImpl:handleBackgroundRefresh Starting background worker")
      // Restrict the refresh task to run only for a maximum of (maxSeconds) seconds
      runBackgroundWorker(task: task, taskType: .refresh, maxSeconds: 20)
    } else {
      FileLogger.log("BackgroundWorkerApiImpl:handleBackgroundRefresh Processing task is in progress")
      task.setTaskCompleted(success: true)
    }
  }
  
  private static func handleBackgroundProcessing(task: BGProcessingTask) {
    FileLogger.log("BackgroundWorkerApiImpl:handleBackgroundProcessing Entered, re-queuing next processing task")
    scheduleProcessingWorker()
    FileLogger.log("BackgroundWorkerApiImpl:handleBackgroundProcessing Waiting for taskSemaphore")
    taskSemaphore.wait()
    FileLogger.log("BackgroundWorkerApiImpl:handleBackgroundProcessing Semaphore acquired, starting background worker")
    // There are no restrictions for processing tasks. Although, the OS could signal expiration at any time
    runBackgroundWorker(task: task, taskType: .processing, maxSeconds: nil)
  }
  
  /**
   * Executes the background worker within the context of a background task.
   * This method creates a BackgroundWorker, sets up task expiration handling,
   * and manages the synchronization between the background task and the Flutter engine.
   *
   * - Parameters:
   *   - task: The iOS background task that provides the execution context
   *   - taskType: The type of background operation to perform (refresh or processing)
   *   - maxSeconds: Optional timeout for the operation in seconds
   */
  private static func runBackgroundWorker(task: BGTask, taskType: BackgroundTaskType, maxSeconds: Int?) {
    defer { taskSemaphore.signal() }
    let semaphore = DispatchSemaphore(value: 0)
    var isSuccess = true
    
    let backgroundWorker = BackgroundWorker(taskType: taskType, maxSeconds: maxSeconds) { success in
      isSuccess = success
      semaphore.signal()
    }

    task.expirationHandler = {
      FileLogger.log("BackgroundWorkerApiImpl:runBackgroundWorker iOS signaled expiration (taskType=\(taskType)), closing worker")
      DispatchQueue.main.async {
        backgroundWorker.close()
      }
      isSuccess = false

      // Schedule a timer to signal the semaphore after 2 seconds
      Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { _ in
        semaphore.signal()
      }
    }

    DispatchQueue.main.async {
      backgroundWorker.run()
    }

    semaphore.wait()
    task.setTaskCompleted(success: isSuccess)
    FileLogger.log("BackgroundWorkerApiImpl:runBackgroundWorker Background task completed with success: \(isSuccess)")
  }
}
