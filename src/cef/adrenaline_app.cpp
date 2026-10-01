#include "adrenaline_app.h"

#if ADREN_FEATURE_CEF

#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"
#include "adrenaline_client.h"

AdrenalineApp::AdrenalineApp() {}

void AdrenalineApp::OnContextInitialized() {
  CEF_REQUIRE_UI_THREAD();

  // Configure CefWindowInfo for platform-specific window setup
  CefWindowInfo window_info;
#if defined(OS_WIN)
  window_info.SetAsPopup(NULL, "Adrenaline Browser");
#elif defined(OS_LINUX)
  window_info.SetAsPopup(0, "Adrenaline Browser");
#endif

  // Configure CefBrowserSettings
  CefBrowserSettings browser_settings;

  // Instantiate AdrenalineClient handler
  CefRefPtr<AdrenalineClient> handler(new AdrenalineClient());

  // Designated initial URL
  std::string url = "https://google.com";

  // Create initial browser host
  CefBrowserHost::CreateBrowser(window_info, handler, url, browser_settings, nullptr, nullptr);
}

#endif // ADREN_FEATURE_CEF
