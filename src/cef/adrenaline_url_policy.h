#ifndef ADRENALINE_CEF_URL_POLICY_H_
#define ADRENALINE_CEF_URL_POLICY_H_

#include <cstdlib>
#include <iostream>
#include <string>

// Remote-URL policy for the CEF engine. The addon runs Chromium in
// `single-process` + `no-sandbox` mode (a Node addon cannot ship a CEF helper
// subprocess), so there is no renderer isolation: remote content must never run
// inside the Node process. Only local schemes are permitted unless the embedder
// explicitly opts in with ADREN_CEF_ALLOW_REMOTE=1.
//
// Shared by window.cpp (API entry points: CreateWindow/NavigateWindow) and
// AdrenalineClient (page-initiated navigation: link clicks and redirects).
namespace adrenaline {

inline bool IsLocalUrl(const std::string& url) {
  static const char* kLocalSchemes[] = {
      "file:", "data:", "about:", "chrome:", "blob:", "devtools:"};
  for (const char* scheme : kLocalSchemes) {
    if (url.rfind(scheme, 0) == 0) {
      return true;
    }
  }
  return false;
}

inline bool IsRemoteUrlAllowed() {
  const char* value = std::getenv("ADREN_CEF_ALLOW_REMOTE");
  return value && std::string(value) == "1";
}

// Returns true when `url` must be rejected (remote content, opt-in not set).
inline bool RejectRemoteUrl(const std::string& url) {
  if (url.empty() || IsLocalUrl(url) || IsRemoteUrlAllowed()) {
    return false;
  }
  std::cerr << "Adrenaline: refusing to load remote URL in single-process mode: "
            << url << " (set ADREN_CEF_ALLOW_REMOTE=1 to override)" << std::endl;
  return true;
}

}  // namespace adrenaline

#endif  // ADRENALINE_CEF_URL_POLICY_H_
