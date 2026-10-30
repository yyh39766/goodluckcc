# 智能选号器 · iOS

一个 WKWebView 壳，加载打包在 APP 里的 `index.html`。页面本身来自桌面版
（pywebview），`Assets/bridge.js` 把 `window.pywebview.api` 重新实现了一遍，
所以页面代码一行都不用改。

## 出 ipa

推到 GitHub，`.github/workflows/build-ipa.yml` 会自动编：

```bash
git init -b main
git add -A
git commit -m "init"
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

然后 **Actions → build-ipa → 最新的 run → Artifacts → LotteryPicker-unsigned-ipa**，
解压得到 `LotteryPicker-unsigned.ipa`。

手动触发：Actions 页面 → build-ipa → **Run workflow**。

## 本地（有 Mac 时）

```bash
brew install xcodegen
xcodegen generate
xcodebuild -project LotteryPicker.xcodeproj -scheme LotteryPicker \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath build \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
mkdir -p Payload && cp -R build/Build/Products/Release-iphoneos/LotteryPicker.app Payload/
zip -qry LotteryPicker-unsigned.ipa Payload
```

## 装到手机

未签名 ipa 在 iOS 15+ 不能直接装，用侧载工具重签：
Sideloadly（Windows 可用，拖进去 + Apple ID，7 天有效）、AltStore/SideStore、
TrollStore（免签，限特定系统版本）、爱思助手。

## 工程说明

| 文件 | 作用 |
|---|---|
| `LotteryPicker/AppDelegate.swift` | 起一个 window-based 应用（没上 Scene，够用且少一层） |
| `LotteryPicker/RootViewController.swift` | 全屏 WKWebView，`contentInsetAdjustmentBehavior = .never` 让 CSS 的 `env(safe-area-inset-*)` 说了算 |
| `LotteryPicker/Bridge.swift` | 5 个原语：http / cacheGet / cacheSet / copy / openReport |
| `LotteryPicker/ReportViewController.swift` | 「方案说明」长文的弹层 |
| `LotteryPicker/Assets/` | index.html、report.html、bridge.js（由 `../build_web.py` 生成，别手改） |
| `Info.plist` | 竖屏、允许 arbitrary loads、`UILaunchScreen`（不加会和刘海屏尺寸不匹配） |

改页面不要改 `Assets/` 里的文件——它们是产物。在桌面工程根目录跑：

```bash
python mobile/build_web.py      # 重新生成 web/ 并同步到 iOS 与 Android
git add -A && git commit -m "update page" && git push
```
