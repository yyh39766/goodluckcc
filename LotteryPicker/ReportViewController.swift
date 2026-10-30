import UIKit
import WebKit

/// 「方案说明」弹层：把 report-v2.html 包进一个带导航栏的 WebView。
/// 页面本身是给桌面写的长文，所以这里不做任何注入，只负责打开和关掉。
final class ReportViewController: UIViewController {

    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "选号器 · 调研与方案"
        view.backgroundColor = .systemBackground

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "关闭", style: .done, target: self, action: #selector(close))

        let cfg = WKWebViewConfiguration()
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        if let url = RootViewController.asset("report.html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            webView.loadHTMLString(
                "<meta name='viewport' content='width=device-width'>"
                + "<p style='font:15px -apple-system;padding:20px;color:#666'>"
                + "包内缺少 Assets/report.html</p>", baseURL: nil)
        }
    }

    @objc private func close() {
        dismiss(animated: true)
    }
}
