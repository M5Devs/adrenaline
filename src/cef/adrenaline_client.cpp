#include "adrenaline_client.h"

#if ADREN_FEATURE_CEF

#include <string>
#include <utility>

#include "include/cef_app.h"
#include "include/cef_parser.h"
#include "include/cef_process_message.h"
#include "include/cef_values.h"
#include "include/wrapper/cef_helpers.h"

#include "adrenaline_app.h"

AdrenalineClient::AdrenalineClient(
    std::function<void(const std::string&, const std::string&)> on_ipc,
    std::function<void()> on_closed)
    : is_closing_(false),
      is_ready_(false),
      is_loaded_(false),
      current_title_(""),
      on_ipc_(std::move(on_ipc)),
      on_closed_(std::move(on_closed)) {}

AdrenalineClient::~AdrenalineClient() {}

bool AdrenalineClient::OnProcessMessageReceived(CefRefPtr<CefBrowser> /*browser*/,
                                                CefRefPtr<CefFrame> /*frame*/,
                                                CefProcessId source_process,
                                                CefRefPtr<CefProcessMessage> message) {
  CEF_REQUIRE_UI_THREAD();

  if (source_process != PID_RENDERER || !message.get()) {
    return false;
  }
  if (message->GetName() != kAdrenalineIpcMessage) {
    return false;
  }

  CefRefPtr<CefListValue> args = message->GetArgumentList();
  if (!args.get() || args->GetSize() < 2) {
    return true;
  }
  if (on_ipc_) {
    on_ipc_(args->GetString(0).ToString(), args->GetString(1).ToString());
  }
  return true;
}

void AdrenalineClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  // Store the active browser reference. The initial URL was already handed to
  // CefBrowserView::CreateBrowserView, which starts the navigation when the view
  // is shown, so loading it again here would duplicate the request.
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

  // Last lifecycle callback for this browser: let the owner release its own
  // browser reference so CefShutdown() can proceed.
  if (on_closed_) {
    on_closed_();
  }
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
