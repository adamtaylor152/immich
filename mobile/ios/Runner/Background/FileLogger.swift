import Foundation

enum FileLogger {
  private static let queue = DispatchQueue(label: "app.alextran.immich.FileLogger")
  private static let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()

  private static var logFileURL: URL? {
    guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    else { return nil }
    return docs.appendingPathComponent("background_log.txt")
  }

  static func log(_ message: String) {
    let line = "[\(isoFormatter.string(from: Date()))] \(message)\n"
    print(line, terminator: "")
    queue.async {
      guard let url = logFileURL, let data = line.data(using: .utf8) else { return }
      if FileManager.default.fileExists(atPath: url.path) {
        if let handle = try? FileHandle(forWritingTo: url) {
          defer { try? handle.close() }
          try? handle.seekToEnd()
          try? handle.write(contentsOf: data)
        }
      } else {
        try? data.write(to: url, options: .atomic)
      }
    }
  }
}
