#include "adrenaline_client.h"

#if ADREN_FEATURE_CEF

#include <sstream>
#include <string>

#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_parser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"

AdrenalineClient::AdrenalineClient() : is_closing_(false) {}

AdrenalineClient::~AdrenalineClient() {}

void AdrenalineClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  // Lifecycle callback for when browser instance is created
}

bool AdrenalineClient::DoClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  // Closing the main window requires special handling. See SimpleHandler in cefsimple.
  if (!is_closing_) {
    is_closing_ = true;
  }

  // Allow the close. For windowed browsers this will result in the OS close event being sent.
  return false;
}

void AdrenalineClient::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  // Lifecycle callback before browser closes
}

void AdrenalineClient::OnTitleChange(CefRefPtr<CefBrowser> browser,
                                      const CefString& title) {
  CEF_REQUIRE_UI_THREAD();

  // Display callback on window/tab title change
}

void AdrenalineClient::OnLoadError(CefRefPtr<CefBrowser> browser,
                                   CefRefPtr<CefFrame> frame,
                                   ErrorCode errorCode,
                                   const CefString& errorText,
                                   const CefString& failedUrl) {
  CEF_REQUIRE_UI_THREAD();

  // Don't record error for "aborted" loads.
  if (errorCode == ERR_ABORTED) {
    return;
  }

  // Handle load errors
}

#endif // ADREN_FEATURE_CEF
