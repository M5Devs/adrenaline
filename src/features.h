#ifndef ADRENALINE_FEATURES_H
#define ADRENALINE_FEATURES_H

// Centralized Feature Flags with sensible defaults for standard build
#ifndef ADREN_FEATURE_DEVTOOLS
#define ADREN_FEATURE_DEVTOOLS 1
#endif

#ifndef ADREN_FEATURE_LOCAL_FILES
#define ADREN_FEATURE_LOCAL_FILES 1
#endif

#ifndef ADREN_FEATURE_PDF
#define ADREN_FEATURE_PDF 0
#endif

#ifndef ADREN_FEATURE_CEF
#define ADREN_FEATURE_CEF 0
#endif

#ifndef ADREN_FEATURE_WEBVIEW
#define ADREN_FEATURE_WEBVIEW 1
#endif

#endif // ADRENALINE_FEATURES_H
