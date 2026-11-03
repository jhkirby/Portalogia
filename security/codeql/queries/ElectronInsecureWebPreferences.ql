/**
 * @name Electron view or window without hardened webPreferences
 * @description Every `BrowserWindow`, `BaseWindow` and `WebContentsView` should set
 *              `contextIsolation: true`, `sandbox: true` and
 *              `nodeIntegration: false` explicitly, and must not turn on
 *              settings that weaken the renderer (webSecurity off, insecure
 *              content, Node in workers/subframes, `<webview>`, Blink flags).
 *              The built-in Electron model doesn't know `WebContentsView`,
 *              which Portalogia uses for every tab and overlay.
 * @kind problem
 * @problem.severity warning
 * @security-severity 7.0
 * @precision high
 * @id portalogia/electron-insecure-webpreferences
 * @tags security
 *       external/cwe/cwe-693
 *       external/cwe/cwe-1188
 */

import javascript

/** `new BrowserWindow(...)`, `new BaseWindow(...)`, `new WebContentsView(...)`, `new BrowserView(...)`. */
class ElectronViewCreation extends DataFlow::NewNode {
  string kind;

  ElectronViewCreation() {
    kind = ["BrowserWindow", "BaseWindow", "WebContentsView", "BrowserView"] and
    this = DataFlow::moduleMember("electron", kind).getAnInstantiation()
  }

  string getKind() { result = kind }

  DataFlow::ObjectLiteralNode getWebPreferences() {
    result = this.getOptionArgument(0, "webPreferences").getALocalSource()
  }
}

/** Holds if `prefs.name` is set to the boolean `value`. */
predicate setsBool(DataFlow::ObjectLiteralNode prefs, string name, boolean value) {
  prefs.getAPropertyWrite(name).getRhs().mayHaveBooleanValue(value) and
  not prefs.getAPropertyWrite(name).getRhs().mayHaveBooleanValue(value.booleanNot())
}

from ElectronViewCreation view, string problem
where
  // `BaseWindow` has no renderer of its own.
  view.getKind() != "BaseWindow" and
  (
    not exists(view.getWebPreferences()) and
    problem = "sets no webPreferences, so it relies on Electron's defaults"
    or
    exists(DataFlow::ObjectLiteralNode prefs | prefs = view.getWebPreferences() |
      exists(string name | name = ["contextIsolation", "sandbox"] |
        not setsBool(prefs, name, true) and problem = "doesn't set " + name + ": true"
      )
      or
      not setsBool(prefs, "nodeIntegration", false) and problem = "doesn't set nodeIntegration: false"
      or
      exists(string name |
        name =
          [
            "allowRunningInsecureContent", "nodeIntegrationInWorker", "nodeIntegrationInSubFrames",
            "webviewTag", "experimentalFeatures"
          ]
      |
        prefs.getAPropertyWrite(name).getRhs().mayHaveBooleanValue(true) and
        problem = "enables " + name
      )
      or
      prefs.getAPropertyWrite("webSecurity").getRhs().mayHaveBooleanValue(false) and
      problem = "disables webSecurity"
      or
      exists(prefs.getAPropertyWrite("enableBlinkFeatures")) and
      problem = "enables Blink features"
    )
  )
select view, "This " + view.getKind() + " " + problem + "."
