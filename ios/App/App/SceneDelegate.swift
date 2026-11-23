import UIKit
import Capacitor

// iOS SDK начиная с Xcode 27 не запускает приложения без UIScene: окно теперь
// принадлежит сцене, а не AppDelegate. Окно с Capacitor создаётся из Main.storyboard
// (UISceneStoryboardFile в Info.plist), а ссылки и Universal Links передаются
// в Capacitor через SceneDelegateProxy — плагин App получает их как раньше.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

class FinuchetBridgeViewController: CAPBridgeViewController {
    private var protectsWatchlist = false
    private var obscuredInBackground = false
    private let privacyCover = UILabel()

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(FinuchetScreenPrivacyPlugin())

        if #available(iOS 17.0, *) {
            registerForTraitChanges([UITraitSceneCaptureState.self]) { (controller: FinuchetBridgeViewController, _) in
                controller.updatePrivacyCover()
            }
        } else {
            NotificationCenter.default.addObserver(self, selector: #selector(captureDidChange),
                                                   name: UIScreen.capturedDidChangeNotification, object: nil)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(sceneWillDeactivate),
                                               name: UIScene.willDeactivateNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(sceneDidActivate),
                                               name: UIScene.didActivateNotification, object: nil)
    }

    func setWatchlistProtection(_ enabled: Bool) {
        protectsWatchlist = enabled
        updatePrivacyCover()
    }

    @objc private func captureDidChange() {
        updatePrivacyCover()
    }

    @objc private func sceneWillDeactivate(_ notification: Notification) {
        guard let scene = notification.object as? UIScene, scene === view.window?.windowScene else { return }
        obscuredInBackground = protectsWatchlist
        updatePrivacyCover()
    }

    @objc private func sceneDidActivate(_ notification: Notification) {
        guard let scene = notification.object as? UIScene, scene === view.window?.windowScene else { return }
        obscuredInBackground = false
        updatePrivacyCover()
    }

    private func updatePrivacyCover() {
        let capturing: Bool
        if #available(iOS 17.0, *) {
            capturing = traitCollection.sceneCaptureState == .active
        } else {
            capturing = view.window?.windowScene?.screen.isCaptured == true
        }
        guard obscuredInBackground || (protectsWatchlist && capturing) else {
            privacyCover.removeFromSuperview()
            return
        }

        if privacyCover.superview == nil {
            privacyCover.frame = view.bounds
            privacyCover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            privacyCover.backgroundColor = .systemBackground
            privacyCover.textColor = .secondaryLabel
            privacyCover.text = "Данные ЧС скрыты"
            privacyCover.textAlignment = .center
            privacyCover.isUserInteractionEnabled = true
            privacyCover.accessibilityViewIsModal = true
            view.addSubview(privacyCover)
        }
        view.bringSubviewToFront(privacyCover)
    }
}

@objc(FinuchetScreenPrivacyPlugin)
final class FinuchetScreenPrivacyPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "FinuchetScreenPrivacyPlugin"
    let jsName = "FinuchetScreenPrivacy"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setProtected", returnType: CAPPluginReturnPromise)!
    ]

    @objc func setProtected(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("Не указан режим защиты экрана.")
            return
        }
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController as? FinuchetBridgeViewController else {
                call.reject("Не удалось включить защиту экрана.")
                return
            }
            controller.setWatchlistProtection(enabled)
            call.resolve()
        }
    }
}
