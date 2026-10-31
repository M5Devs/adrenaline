#include "adrenaline_app.h"

#if ADREN_FEATURE_CEF

#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"
#include "adrenaline_client.h"

AdrenalineApp::AdrenalineApp() {}

void AdrenalineApp::OnBeforeCommandLineProcessing(
    const CefString& process_type,
    CefRefPtr<CefCommandLine> command_line) {
  if (!command_line.get()) {
    return;
  }

  // Modular Feature Elimination Engine: switches are compiled in only when the
  // corresponding module is requested in adrenaline.config.js.
#if ADREN_FEATURE_CLEAN_PRIVACY
  // Ungoogled / performance optimizations.
  command_line->AppendSwitch("enable-low-end-device-mode");
  command_line->AppendSwitch("no-pings");
  command_line->AppendSwitch("disable-background-networking");
  command_line->AppendSwitch("hide-crashed-bubble");
#endif

#if ADREN_FEATURE_WEBRTC == 0
  // WebRTC physically disabled and isolated onto non-proxied UDP only.
  command_line->AppendSwitch("disable-webrtc");
  command_line->AppendSwitchWithValue("webrtc-ip-handling-policy", "disable_non_proxied_udp");
#endif

#if ADREN_FEATURE_PDF == 0
  command_line->AppendSwitch("disable-pdf-extension");
#endif
}

void AdrenalineApp::OnContextInitialized() {
  CEF_REQUIRE_UI_THREAD();

  // Modern CEF (>= 120) creates top-level browsers through the Views API
  // rather than the legacy CefWindowInfo::SetAsPopup path.
  CefBrowserSettings browser_settings;

  CefRefPtr<AdrenalineClient> handler(new AdrenalineClient());

  CefRefPtr<CefBrowserView> browser_view = CefBrowserView::CreateBrowserView(
      handler, "https://google.com", browser_settings, nullptr, nullptr, nullptr);

  CefRefPtr<CefWindow> window = CefWindow::CreateTopLevelWindow(nullptr);
  window->AddChildView(browser_view);
  window->Show();
}

#endif // ADREN_FEATURE_CEF
