#ifndef ADRENALINE_CEF_CLIENT_H_
#define ADRENALINE_CEF_CLIENT_H_

#include "../features.h"

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
  virtual void OnLoadError(CefRefPtr<CefBrowser> browser,
                           CefRefPtr<CefFrame> frame,
                           ErrorCode errorCode,
                           const CefString& errorText,
                           const CefString& failedUrl) OVERRIDE;

  bool IsClosing() const { return is_closing_; }

private:
  bool is_closing_;

  // Include the default reference counting implementation.
  IMPLEMENT_REFCOUNTING(AdrenalineClient);
  DISALLOW_COPY_AND_ASSIGN(AdrenalineClient);
};

#endif // ADREN_FEATURE_CEF

#endif // ADRENALINE_CEF_CLIENT_H_
