#ifndef ADRENALINE_FEATURES_H
#define ADRENALINE_FEATURES_H

// Centralized Feature Flags. Defaults match `adrenaline.config.js`; the build
// overrides them with -D flags resolved by lib/config-resolver.js.
#ifndef ADREN_FEATURE_DEVTOOLS
#define ADREN_FEATURE_DEVTOOLS 1
#endif

#ifndef ADREN_FEATURE_LOCAL_FILES
#define ADREN_FEATURE_LOCAL_FILES 1
#endif

#ifndef ADREN_FEATURE_PDF
#define ADREN_FEATURE_PDF 0
#endif

#ifndef ADREN_FEATURE_WEBRTC
#define ADREN_FEATURE_WEBRTC 1
#endif

#ifndef ADREN_FEATURE_CLEAN_PRIVACY
#define ADREN_FEATURE_CLEAN_PRIVACY 0
#endif

#ifndef ADREN_FEATURE_CEF
#define ADREN_FEATURE_CEF 0
#endif

#ifndef ADREN_FEATURE_WEBVIEW
#define ADREN_FEATURE_WEBVIEW 1
#endif

#endif // ADRENALINE_FEATURES_H
