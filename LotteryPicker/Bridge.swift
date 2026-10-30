import Foundation
import WebKit
import UIKit

/// JS ↔ 原生 的唯一通道。
///
/// 刻意做得很薄：只提供 http / cacheGet / cacheSet / copy / openReport 五个原语。
/// 抓彩站接口、解析、归一化的活全在 bridge.js 里干，和 Android 用同一份代码，
/// 免得两端各写一套解析器、各错一遍。
final class Bridge: NSObject, WKScriptMessageHandler {

    weak var webView: WKWebView?
    var onOpenReport: (() -> Void)?

    private let cacheDir: URL

    override init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        cacheDir = base.appendingPathComponent("picker", isDirectory: true)
        super.init()
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    }

    // MARK: - 入口

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let method = body["method"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]

        switch method {
        case "http":        http(id, args)
        case "cacheGet":    cacheGet(id, args)
        case "cacheSet":    cacheSet(id, args)
        case "copy":        copy(id, args)
        case "openReport":  openReport(id)
        default:            reply(id, ok: false, error: "未知方法 \(method)")
        }
    }

    // MARK: - 原语

    private func http(_ id: String, _ args: [String: Any]) {
        guard let urlStr = args["url"] as? String,
              let url = URL(string: urlStr) else {
            reply(id, ok: false, error: "URL 不合法")
            return
        }
        let timeout = (args["timeout"] as? NSNumber)?.doubleValue ?? 15

        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = "GET"
        req.setValue("gzip, deflate", forHTTPHeaderField: "Accept-Encoding")
        if let headers = args["headers"] as? [String: Any] {
            for (k, v) in headers {
                if let s = v as? String { req.setValue(s, forHTTPHeaderField: k) }
            }
        }

        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = timeout
        cfg.timeoutIntervalForResource = timeout + 5
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.httpShouldSetCookies = false

        let session = URLSession(configuration: cfg)
        session.dataTask(with: req) { [weak self] data, resp, err in
            guard let self = self else { return }
            defer { session.finishTasksAndInvalidate() }
            if let err = err {
                self.reply(id, ok: false, error: err.localizedDescription)
                return
            }
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            if text.isEmpty {
                self.reply(id, ok: false, error: "空响应（HTTP \(status)）")
            } else {
                self.reply(id, ok: true, data: ["status": status, "body": text])
            }
        }.resume()
    }

    private func cacheGet(_ id: String, _ args: [String: Any]) {
        guard let key = safeName(args["key"] as? String) else {
            reply(id, ok: false, error: "key 不合法"); return
        }
        let url = cacheDir.appendingPathComponent(key)
        let text = try? String(contentsOf: url, encoding: .utf8)
        var payload: [String: Any] = [:]
        if let text = text {
            payload["value"] = text
        } else {
            payload["value"] = NSNull()
        }
        reply(id, ok: true, data: payload)
    }

    private func cacheSet(_ id: String, _ args: [String: Any]) {
        guard let key = safeName(args["key"] as? String),
              let value = args["value"] as? String else {
            reply(id, ok: false, error: "参数不合法"); return
        }
        let url = cacheDir.appendingPathComponent(key)
        do {
            try value.write(to: url, atomically: true, encoding: .utf8)
            reply(id, ok: true, data: ["bytes": value.utf8.count])
        } catch {
            reply(id, ok: false, error: error.localizedDescription)
        }
    }

    private func copy(_ id: String, _ args: [String: Any]) {
        let text = (args["text"] as? String) ?? ""
        DispatchQueue.main.async {
            UIPasteboard.general.string = text
            self.reply(id, ok: true, data: ["len": text.count])
        }
    }

    private func openReport(_ id: String) {
        DispatchQueue.main.async {
            self.onOpenReport?()
            self.reply(id, ok: true, data: ["opened": true])
        }
    }

    // MARK: - 回包

    private func reply(_ id: String, ok: Bool, data: Any? = nil, error: String? = nil) {
        var obj: [String: Any] = ["id": id, "ok": ok]
        if let d = data { obj["data"] = d }
        if let e = error { obj["error"] = e }
        guard let json = Self.encode(obj) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "window.__NATIVE_REPLY && window.__NATIVE_REPLY(\(json))",
                completionHandler: nil)
        }
    }

    private static func encode(_ obj: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(obj),
              let d = try? JSONSerialization.data(withJSONObject: obj, options: []),
              let s = String(data: d, encoding: .utf8) else { return nil }
        return s
    }

    /// 只允许用字母数字和点横线下划线，杜绝 key 里掺 ../ 写出沙盒
    private func safeName(_ raw: String?) -> String? {
        guard let s = raw, !s.isEmpty, s.count <= 64 else { return nil }
        let ok = s.unicodeScalars.allSatisfy { sc in
            sc.value == 46 || sc.value == 95 || sc.value == 45      // . _ -
                || (sc.value >= 48 && sc.value <= 57)               // 0-9
                || (sc.value >= 65 && sc.value <= 90)               // A-Z
                || (sc.value >= 97 && sc.value <= 122)              // a-z
        }
        return ok ? s : nil
    }
}
