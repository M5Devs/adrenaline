#include "adrenaline_app.h"

#if ADREN_FEATURE_CEF

#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"

AdrenalineApp::AdrenalineApp() {}

void AdrenalineApp::OnContextInitialized() {
  CEF_REQUIRE_UI_THREAD();

  // Dispatch window creation events or initial browser setup when context is initialized
}

#endif // ADREN_FEATURE_CEF
