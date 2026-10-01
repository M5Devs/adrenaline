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

AdrenalineClient::AdrenalineClient()
    : is_closing_(false), is_ready_(false), is_loaded_(false), current_title_("") {}

AdrenalineClient::~AdrenalineClient() {}

void AdrenalineClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  // Store the active browser reference
  browser_ = browser;

  // Prepare thread-safe notification signaling browser host creation and readiness
  is_ready_ = true;
}

bool AdrenalineClient::DoClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  // Closing the main window requires special handling.
  if (!is_closing_) {
    is_closing_ = true;
  }

  // Allow the close. For windowed browsers this will result in the OS close event being sent.
  return false;
}

void AdrenalineClient::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  // Release browser reference safely and notify application lifecycle
  if (browser_ && browser_->IsSame(browser)) {
    browser_ = nullptr;
  }
  is_ready_ = false;
}

void AdrenalineClient::OnTitleChange(CefRefPtr<CefBrowser> browser,
                                      const CefString& title) {
  CEF_REQUIRE_UI_THREAD();

  // Extract UTF-8 string from title and emit title update event
  current_title_ = title.ToString();
}

void AdrenalineClient::OnLoadEnd(CefRefPtr<CefBrowser> browser,
                                 CefRefPtr<CefFrame> frame,
                                 int httpStatusCode) {
  CEF_REQUIRE_UI_THREAD();

  // Emit page loaded status
  if (frame->IsMain()) {
    is_loaded_ = true;
  }
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
  if (frame->IsMain()) {
    is_loaded_ = false;
  }
}

#endif // ADREN_FEATURE_CEF
