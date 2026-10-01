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
