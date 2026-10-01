#ifndef ADRENALINE_CEF_CLIENT_H_
#define ADRENALINE_CEF_CLIENT_H_

#include "../features.h"
#include <string>

#if ADREN_FEATURE_CEF

#include "include/cef_client.h"

class AdrenalineClient : public CefClient,
                         public CefDisplayHandler,
                         public CefLifeSpanHandler,
                         public CefLoadHandler {
public:
  AdrenalineClient();
  virtual ~AdrenalineClient();

  // CefClient methods:
  virtual CefRefPtr<CefDisplayHandler> GetDisplayHandler() OVERRIDE {
    return this;
  }
  virtual CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() OVERRIDE {
    return this;
  }
  virtual CefRefPtr<CefLoadHandler> GetLoadHandler() OVERRIDE {
    return this;
  }

  // CefLifeSpanHandler methods:
  virtual void OnAfterCreated(CefRefPtr<CefBrowser> browser) OVERRIDE;
  virtual bool DoClose(CefRefPtr<CefBrowser> browser) OVERRIDE;
  virtual void OnBeforeClose(CefRefPtr<CefBrowser> browser) OVERRIDE;

  // CefDisplayHandler methods:
  virtual void OnTitleChange(CefRefPtr<CefBrowser> browser,
                             const CefString& title) OVERRIDE;

  // CefLoadHandler methods:
  virtual void OnLoadEnd(CefRefPtr<CefBrowser> browser,
                         CefRefPtr<CefFrame> frame,
                         int httpStatusCode) OVERRIDE;
  virtual void OnLoadError(CefRefPtr<CefBrowser> browser,
                           CefRefPtr<CefFrame> frame,
                           ErrorCode errorCode,
                           const CefString& errorText,
                           const CefString& failedUrl) OVERRIDE;

  bool IsClosing() const { return is_closing_; }
  bool IsReady() const { return is_ready_; }
  bool IsLoaded() const { return is_loaded_; }
  std::string GetTitle() const { return current_title_; }
  CefRefPtr<CefBrowser> GetBrowser() const { return browser_; }

private:
  CefRefPtr<CefBrowser> browser_;
  bool is_closing_;
  bool is_ready_;
  bool is_loaded_;
  std::string current_title_;

  // Include the default reference counting implementation.
  IMPLEMENT_REFCOUNTING(AdrenalineClient);
  DISALLOW_COPY_AND_ASSIGN(AdrenalineClient);
};

#else

// Mock/stub implementation for lightweight build (ADREN_FEATURE_CEF == 0)
class AdrenalineClient {
public:
  AdrenalineClient() : is_closing_(false), is_ready_(false), is_loaded_(false) {}
  ~AdrenalineClient() = default;

  bool IsClosing() const { return is_closing_; }
  bool IsReady() const { return is_ready_; }
  bool IsLoaded() const { return is_loaded_; }
  std::string GetTitle() const { return current_title_; }

private:
  bool is_closing_{false};
  bool is_ready_{false};
  bool is_loaded_{false};
  std::string current_title_{""};
};

#endif // ADREN_FEATURE_CEF

#endif // ADRENALINE_CEF_CLIENT_H_
