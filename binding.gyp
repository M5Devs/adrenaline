{
  "targets": [
    {
      "target_name": "adrenaline",
      "sources": [
        "src/main.cpp",
        "src/window.cpp",
        "src/dialog.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_CPP_EXCEPTIONS"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "cflags_cc": [ "-std=c++17", "-fexceptions" ],
      "conditions": [
        ['OS=="linux"', {
          "cflags": [
            "<!@(pkg-config --cflags gtk+-3.0 webkit2gtk-4.1 2>/dev/null || pkg-config --cflags gtk+-3.0 webkit2gtk-4.0)"
          ],
          "ldflags": [
            "<!@(pkg-config --libs gtk+-3.0 webkit2gtk-4.1 2>/dev/null || pkg-config --libs gtk+-3.0 webkit2gtk-4.0)"
          ],
          "libraries": [
            "<!@(pkg-config --libs gtk+-3.0 webkit2gtk-4.1 2>/dev/null || pkg-config --libs gtk+-3.0 webkit2gtk-4.0)"
          ]
        }],
        ['OS=="mac"', {
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          },
          "link_settings": {
            "libraries": [
              "-framework WebKit",
              "-framework Cocoa"
            ]
          }
        }],
        ['OS=="win"', {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "-std:c++17" ]
            }
          }
        }]
      ]
    }
  ]
}
