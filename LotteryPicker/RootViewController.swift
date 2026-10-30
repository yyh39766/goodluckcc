import UIKit
import WebKit

final class RootViewController: UIViewController, WKNavigationDelegate {

    private var webView: WKWebView!
    private var bridge: Bridge!
    private var loadedOK = false

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = UIColor(red: 0.957, green: 0.965, blue: 0.984, alpha: 1)

        let cfg = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        cfg.userContentController = ucc
        cfg.allowsInlineMediaPlayback = true
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        cfg.defaultWebpagePreferences.preferredContentMode = .mobile
        // 本地包不需要持久化 cookie，避免上一版残留
        cfg.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        // 不加这个，WebKit 会在已留出安全区的基础上再缩一圈，顶部空一条白
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = true
        webView.allowsBackForwardNavigationGestures = false

        bridge = Bridge()
        bridge.webView = webView
        bridge.onOpenReport = { [weak self] in self?.presentReport() }
        ucc.add(bridge, name: "native")

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        loadApp()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    // MARK: - 加载

    private func loadApp() {
        guard let url = RootViewController.asset("index.html") else {
            showFatal("包内缺少 Assets/index.html")
            return
        }
        loadedOK = false
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    static func asset(_ name: String) -> URL? {
        if let u = Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "Assets") {
            return u
        }
        return Bundle.main.url(forResource: name, withExtension: nil)
    }

    private func showFatal(_ text: String) {
        let label = UILabel()
        label.text = text
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.font = .systemFont(ofSize: 15)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.8)
        ])
    }

    // MARK: - 调研长文

    private func presentReport() {
        let vc = ReportViewController()
        let nav = UINavigationController(rootViewController: vc)
        nav.modalPresentationStyle = .fullScreen
        present(nav, animated: true)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadedOK = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        if !loadedOK { showFatal("页面加载失败：\(error.localizedDescription)") }
    }

    // 外链一律交回系统浏览器，别把用户困在一个没有地址栏的 WebView 里
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow); return
        }
        if url.isFileURL || url.scheme == "about" {
            decisionHandler(.allow); return
        }
        if navigationAction.navigationType == .linkActivated,
           let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // WebContent 进程被系统回收后自动拉回来，用户看到的是一个静止页面最糟
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
