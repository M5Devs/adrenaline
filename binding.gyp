{
  "variables": {
    "adren_engine%": "<!(node -p \"process.env.ADREN_ENGINE || 'webview'\")",
    "cef_root": "<!(node -p \"require('path').resolve(process.env.CEF_ROOT || 'vendor/cef')\")"
  },
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
        "NAPI_CPP_EXCEPTIONS",
        "<!@(node -p \"require('./lib/config-resolver').gypDefines()\")"
      ],
      "cflags!": [
        "-fno-exceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-fexceptions"
      ],
      "conditions": [
        [
          "adren_engine=='cef'",
          {
            "defines": [
              "ADREN_FEATURE_CEF=1",
              "ADREN_FEATURE_WEBVIEW=0",
              "CEF_USE_SANDBOX"
            ],
            "sources": [
              "src/cef/adrenaline_app.cpp",
              "src/cef/adrenaline_client.cpp"
            ],
            "include_dirs": [
              "<(cef_root)",
              "<(cef_root)/include"
            ],
            "libraries": [
              "<(cef_root)/libcef_dll_wrapper/libcef_dll_wrapper.a",
              "-L<(cef_root)/Release",
              "-lcef",
              "-Wl,-rpath,<(cef_root)/Release"
            ],
            "cflags_cc": [
              "-std=c++20"
            ]
          }
        ],
        [
          "OS=='linux'",
          {
            "cflags": [
              "<!@(pkg-config --cflags gtk+-3.0 webkit2gtk-4.1 2>/dev/null || pkg-config --cflags gtk+-3.0 webkit2gtk-4.0)"
            ],
            "ldflags": [
              "<!@(pkg-config --libs gtk+-3.0 webkit2gtk-4.1 2>/dev/null || pkg-config --libs gtk+-3.0 webkit2gtk-4.0)"
            ],
            "libraries": [
              "-lX11",
              "<!@(pkg-config --libs gtk+-3.0 webkit2gtk-4.1 2>/dev/null || pkg-config --libs gtk+-3.0 webkit2gtk-4.0)"
            ]
          }
        ],
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "link_settings": {
              "libraries": [
                "-framework WebKit",
                "-framework Cocoa"
              ]
            }
          }
        ],
        [
          "OS=='win'",
          {
            "libraries": [
              "advapi32.lib",
              "ole32.lib",
              "shell32.lib",
              "user32.lib",
              "shlwapi.lib"
            ]
          }
        ],
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": [
                  "-std:c++17"
                ]
              }
            }
          }
        ]
      ]
    }
  ]
}
