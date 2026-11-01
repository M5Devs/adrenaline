#include "window.h"
#include "features.h"

#include <thread>
#include <mutex>
#include <unordered_map>
#include <memory>
#include <atomic>
#include <string>
#include <iostream>
#include <functional>
#include <future>
#include <deque>
#include <chrono>
#include <vector>
#include <utility>
#include <cstdlib>
#include <filesystem>

#if ADREN_FEATURE_CEF
#include "cef/adrenaline_app.h"
#include "cef/adrenaline_client.h"
#include "include/cef_app.h"
#include "include/capi/cef_app_capi.h"
#include "include/cef_browser.h"
#include "include/cef_frame.h"
#include "include/cef_parser.h"
#include "include/cef_task.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"
#include <dlfcn.h>
#include <unistd.h>
#else
#include "vendor/webview.h"
#endif

namespace Adrenaline {

struct WindowInstance {
    int id;
    std::string title;
    int width;
    int height;
    std::string url;
    std::string html;

    bool resizable{true};
    int minWidth{0};
    int minHeight{0};
    int maxWidth{0};
    int maxHeight{0};

    bool lowEndDeviceMode{true};
    bool privacyShield{true};

#if ADREN_FEATURE_CEF
    // CEF engine state. Owned by the engine thread; the JS thread only ever
    // touches it by posting tasks to the engine queue.
    CefRefPtr<CefBrowser> browser;
    CefRefPtr<CefWindow> window;
    bool closing{false};
    // Set from OnBeforeClose (engine thread) once CEF has fully torn the browser
    // down. Shutdown waits on this instead of a fixed drain timeout.
    std::atomic<bool> browser_closed{false};
#else
    // Owned by the engine thread and only ever touched from it. The JS thread
    // interacts with it exclusively by posting tasks to the engine queue.
    std::shared_ptr<webview::webview> wv;
#endif

    Napi::ThreadSafeFunction tsfn;
    bool has_tsfn{false};
    std::atomic<bool> tsfn_released{false};
};

static std::atomic<int> g_next_window_id{1};

// The registry is heap-allocated so it is never destroyed by a static
// destructor at process exit; teardown happens explicitly via shutdown().
static std::unordered_map<int, std::shared_ptr<WindowInstance>>& windows_map() {
    static auto* m = new std::unordered_map<int, std::shared_ptr<WindowInstance>>();
    return *m;
}
static std::mutex g_windows_mutex;

// Closed windows are parked here rather than destroyed: WebKit aborts when a
// webview is torn down, and the OS reclaims the memory at process exit.
static std::vector<std::shared_ptr<WindowInstance>>& closed_windows() {
    static auto* v = new std::vector<std::shared_ptr<WindowInstance>>();
    return *v;
}
static std::mutex g_closed_mutex;

#if ADREN_FEATURE_CEF
// Every window ever created, kept for the lifetime of the process so CEF
// shutdown can find browsers that were closed (and thus removed from
// windows_map()) but whose OnBeforeClose has not yet run.
static std::vector<std::shared_ptr<WindowInstance>>& all_windows() {
    static auto* v = new std::vector<std::shared_ptr<WindowInstance>>();
    return *v;
}
static std::mutex g_all_windows_mutex;
#endif

// GTK/WebKit are single-threaded: every gtk_*/webkit_* call, and iteration of
// the default GMainContext, must happen on one thread. Running a main loop per
// window corrupts the heap, so all windows live on one dedicated engine thread
// and the JS thread only ever posts work to it.
namespace {
struct EngineState {
    std::thread thread;
    std::mutex mutex;
    std::deque<std::function<void()>> tasks;
    bool started{false};
    bool stop{false};
};

// Intentionally leaked: the engine thread must never be torn down by a static
// destructor at process exit (a joinable std::thread would call
// std::terminate, and destroying GTK state races with the still-running thread).
// The normal teardown path joins the thread via ShutdownWindows(); if the
// process exits without it, the OS reclaims everything.
EngineState& engine() {
    static EngineState* state = new EngineState();
    return *state;
}

void EngineThreadMain() {
#if ADREN_FEATURE_CEF
    // CEF drives its own UI thread via an external message pump: we own the
    // loop and must call CefDoMessageLoopWork() periodically. Without a sleep
    // CEF's timers never elapse, so a short pause keeps them ticking.
    for (;;) {
        for (;;) {
            std::function<void()> task;
            {
                std::lock_guard<std::mutex> lock(engine().mutex);
                if (engine().tasks.empty()) {
                    break;
                }
                task = std::move(engine().tasks.front());
                engine().tasks.pop_front();
            }
            task();
        }

        {
            std::lock_guard<std::mutex> lock(engine().mutex);
            if (engine().stop && engine().tasks.empty()) {
                break;
            }
        }

        CefDoMessageLoopWork();
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
#else
    GMainContext* ctx = g_main_context_default();
    for (;;) {
        for (;;) {
            std::function<void()> task;
            {
                std::lock_guard<std::mutex> lock(engine().mutex);
                if (engine().tasks.empty()) {
                    break;
                }
                task = std::move(engine().tasks.front());
                engine().tasks.pop_front();
            }
            task();
        }

        {
            std::lock_guard<std::mutex> lock(engine().mutex);
            if (engine().stop && engine().tasks.empty()) {
                break;
            }
        }

        // Block until the next GTK/WebKit event or a wakeup from a new task.
        g_main_context_iteration(ctx, TRUE);
    }
#endif
}

void EnsureEngineThread() {
    std::lock_guard<std::mutex> lock(engine().mutex);
    if (engine().started) {
        return;
    }
    engine().started = true;
    engine().thread = std::thread(EngineThreadMain);
}

void PushEngineTask(std::function<void()> fn) {
    {
        std::lock_guard<std::mutex> lock(engine().mutex);
        engine().tasks.push_back(std::move(fn));
    }
#if ADREN_FEATURE_CEF
    // The CEF loop wakes on its own; nothing else to signal.
#else
    g_main_context_wakeup(g_main_context_default());
#endif
}

// Runs fn on the engine thread and waits for it to finish.
void RunOnEngine(const std::function<void()>& fn) {
    EnsureEngineThread();
    std::promise<void> done;
    std::future<void> finished = done.get_future();
    PushEngineTask([&fn, &done]() {
        try {
            fn();
        } catch (...) {
        }
        done.set_value();
    });
    finished.wait();
}

// Let pending engine work settle before tearing a window down. Destroying a
// webview while WebKit is still loading leaves JSC state that aborts during
// process exit, so pump the loop until it goes quiet (or the budget expires).
void DrainEngine(int max_ms) {
#if ADREN_FEATURE_CEF
    auto deadline = std::chrono::steady_clock::now() +
                    std::chrono::milliseconds(max_ms);
    while (std::chrono::steady_clock::now() < deadline) {
        CefDoMessageLoopWork();
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
#else
    GMainContext* ctx = g_main_context_default();
    auto deadline = std::chrono::steady_clock::now() +
                    std::chrono::milliseconds(max_ms);
    while (std::chrono::steady_clock::now() < deadline) {
        if (!g_main_context_iteration(ctx, FALSE)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
    }
#endif
}

#if ADREN_FEATURE_CEF
// Directory containing libcef.so (and therefore icudtl.dat). Resolved from the
// loaded shared object so the addon can be copied around without recompiling.
// `cef_initialize` is the raw C entry point and is only defined by libcef.so;
// the C++ `CefInitialize` thunk lives in the addon itself, so dladdr on it
// would report the addon's directory instead.
std::string CefModuleDir() {
    Dl_info dl_info;
    if (dladdr(reinterpret_cast<void*>(&cef_initialize), &dl_info) && dl_info.dli_fname) {
        std::string path(dl_info.dli_fname);
        auto slash = path.find_last_of('/');
        if (slash != std::string::npos) {
            return path.substr(0, slash);
        }
    }
    return ".";
}

// Environment override first, then `candidates` (relative to the module dir),
// returning the first path that exists on disk.
std::string ResolveCefSubdir(const char* env_name,
                             const std::vector<std::string>& candidates) {
    const char* env = std::getenv(env_name);
    if (env && *env) {
        return env;
    }
    const std::string module_dir = CefModuleDir();
    for (const auto& rel : candidates) {
        std::string full = module_dir + "/" + rel;
        if (access(full.c_str(), F_OK) == 0) {
            return full;
        }
    }
    return module_dir + "/" + candidates.front();
}

// Resolve a writable, per-process CEF cache directory. `root_cache_path`
// defaults to `cache_path`, so sharing it across instances makes them fight over
// the same process-singleton root; a unique child keeps concurrent instances
// apart. The module directory is often read-only, so prefer the user cache dir.
std::string ResolveCefCacheDir() {
    const char* override = std::getenv("ADREN_CEF_CACHE");
    if (override && *override) {
        return override;
    }
    std::string base;
    const char* xdg = std::getenv("XDG_CACHE_HOME");
    if (xdg && *xdg) {
        base = xdg;
    } else {
        const char* home = std::getenv("HOME");
        base = (home && *home) ? (std::string(home) + "/.cache") : "/tmp";
    }
    return base + "/adrenaline/cef-" + std::to_string(getpid());
}

// The cache directory is unique per process; remove it after CefShutdown so
// repeated runs do not accumulate directories. An explicit ADREN_CEF_CACHE is
// left untouched (the embedder chose it).
void RemoveCefCacheDir(const std::string& cache_dir) {
    const char* override = std::getenv("ADREN_CEF_CACHE");
    if (override && *override) {
        return;
    }
    std::error_code ec;
    std::filesystem::remove_all(cache_dir, ec);
}

// With `single-process` + `no-sandbox` there is no renderer isolation, so remote
// content must never run inside the Node process. Only local schemes are
// permitted unless the embedder explicitly opts in via ADREN_CEF_ALLOW_REMOTE=1.
bool IsLocalUrl(const std::string& url) {
    static const char* kLocalSchemes[] = {
        "file:", "data:", "about:", "chrome:", "blob:", "devtools:"
    };
    for (const char* scheme : kLocalSchemes) {
        if (url.rfind(scheme, 0) == 0) {
            return true;
        }
    }
    return false;
}

bool IsRemoteUrlAllowed() {
    const char* value = std::getenv("ADREN_CEF_ALLOW_REMOTE");
    return value && std::string(value) == "1";
}

// Returns true when `url` must be rejected (remote content, opt-in not set).
bool RejectRemoteUrl(const std::string& url) {
    if (url.empty() || IsLocalUrl(url) || IsRemoteUrlAllowed()) {
        return false;
    }
    std::cerr << "Adrenaline: refusing to load remote URL in single-process mode: "
              << url << " (set ADREN_CEF_ALLOW_REMOTE=1 to override)" << std::endl;
    return true;
}

// CEF must be initialized exactly once, on the thread that pumps its message
// loop. `CefExecuteProcess` returning >= 0 means this process is a CEF helper
// subprocess and must exit immediately.
bool EnsureCefInitialized() {
    static bool initialized = false;
    static bool failed = false;
    if (initialized) {
        return true;
    }
    if (failed) {
        return false;
    }

    // CEF parses its switches from argv and needs at least argv[0]; an empty
    // CefMainArgs corrupts early startup (it crashes in LoadLocalState). The
    // addon has no argc/argv, so reconstruct them from /proc/self/cmdline.
    std::vector<std::string> argv_storage;
    {
        FILE* f = fopen("/proc/self/cmdline", "rb");
        if (f) {
            std::string buf;
            char chunk[4096];
            size_t n;
            while ((n = fread(chunk, 1, sizeof(chunk), f)) > 0) {
                buf.append(chunk, n);
            }
            fclose(f);
            size_t start = 0;
            while (start < buf.size()) {
                size_t end = buf.find('\0', start);
                if (end == std::string::npos) {
                    end = buf.size();
                }
                if (end > start) {
                    argv_storage.push_back(buf.substr(start, end - start));
                }
                start = end + 1;
            }
        }
        if (argv_storage.empty()) {
            argv_storage.push_back("adrenaline");
        }
    }

    std::vector<char*> argv;
    argv.reserve(argv_storage.size() + 1);
    for (auto& s : argv_storage) {
        argv.push_back(const_cast<char*>(s.c_str()));
    }
    argv.push_back(nullptr);

    CefMainArgs args(static_cast<int>(argv_storage.size()), argv.data());
    int exit_code = CefExecuteProcess(args, nullptr, nullptr);
    if (exit_code >= 0) {
        std::_Exit(exit_code);
    }

    CefSettings settings;
    settings.no_sandbox = true;
    settings.log_severity = LOGSEVERITY_WARNING;
    // A Node addon cannot spawn CEF's helper executables, so everything runs
    // in-process.
    settings.multi_threaded_message_loop = false;
    settings.external_message_pump = true;

    // icudtl.dat must be found next to libcef.so (CEF resolves it relative to
    // the module, and neither resources_dir_path nor --icu-data-file override
    // it), but the .pak bundles and locales may live in a sibling Resources/.
    CefString(&settings.resources_dir_path) =
        ResolveCefSubdir("ADREN_CEF_RESOURCES", {"../Resources", "Resources", "."});
    CefString(&settings.locales_dir_path) =
        ResolveCefSubdir("ADREN_CEF_LOCALES", {"../Resources/locales", "Resources/locales", "locales"});
    CefString(&settings.locale) = "en-US";

    std::string cache_dir = ResolveCefCacheDir();
    CefString(&settings.cache_path) = cache_dir;

    CefRefPtr<AdrenalineApp> app(new AdrenalineApp());
    if (!CefInitialize(args, settings, app, nullptr)) {
        failed = true;
        return false;
    }
    initialized = true;
    return true;
}
#endif
} // namespace


Napi::Value GetCompiledFeatures(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object feats = Napi::Object::New(env);

    feats.Set("devtools", Napi::Boolean::New(env, ADREN_FEATURE_DEVTOOLS != 0));
    feats.Set("localFiles", Napi::Boolean::New(env, ADREN_FEATURE_LOCAL_FILES != 0));
    feats.Set("pdf", Napi::Boolean::New(env, ADREN_FEATURE_PDF != 0));
    feats.Set("webrtc", Napi::Boolean::New(env, ADREN_FEATURE_WEBRTC != 0));
    feats.Set("cleanPrivacy", Napi::Boolean::New(env, ADREN_FEATURE_CLEAN_PRIVACY != 0));
    feats.Set("cef", Napi::Boolean::New(env, ADREN_FEATURE_CEF != 0));
    feats.Set("webview", Napi::Boolean::New(env, ADREN_FEATURE_WEBVIEW != 0));

    return feats;
}

Napi::Value CreateWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string title = "Adrenaline Window";
    int width = 800;
    int height = 600;
    std::string url = "";
    std::string html = "";
    bool resizable = true;
    int minWidth = 0;
    int minHeight = 0;
    int maxWidth = 0;
    int maxHeight = 0;
    bool lowEndDeviceMode = true;
    bool privacyShield = true;

    Napi::Function ipc_cb;
    bool has_ipc_cb = false;

    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();

        if (opts.Has("title") && opts.Get("title").IsString()) {
            title = opts.Get("title").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("width") && opts.Get("width").IsNumber()) {
            width = opts.Get("width").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("height") && opts.Get("height").IsNumber()) {
            height = opts.Get("height").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("url") && opts.Get("url").IsString()) {
            url = opts.Get("url").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("html") && opts.Get("html").IsString()) {
            html = opts.Get("html").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("resizable") && opts.Get("resizable").IsBoolean()) {
            resizable = opts.Get("resizable").As<Napi::Boolean>().Value();
        }
        if (opts.Has("minWidth") && opts.Get("minWidth").IsNumber()) {
            minWidth = opts.Get("minWidth").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("minHeight") && opts.Get("minHeight").IsNumber()) {
            minHeight = opts.Get("minHeight").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("maxWidth") && opts.Get("maxWidth").IsNumber()) {
            maxWidth = opts.Get("maxWidth").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("maxHeight") && opts.Get("maxHeight").IsNumber()) {
            maxHeight = opts.Get("maxHeight").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("lowEndDeviceMode") && opts.Get("lowEndDeviceMode").IsBoolean()) {
            lowEndDeviceMode = opts.Get("lowEndDeviceMode").As<Napi::Boolean>().Value();
        }
        if (opts.Has("privacyShield") && opts.Get("privacyShield").IsBoolean()) {
            privacyShield = opts.Get("privacyShield").As<Napi::Boolean>().Value();
        }
        if (opts.Has("onIpc") && opts.Get("onIpc").IsFunction()) {
            ipc_cb = opts.Get("onIpc").As<Napi::Function>();
            has_ipc_cb = true;
        }
    }

    if (!has_ipc_cb && info.Length() > 1 && info[1].IsFunction()) {
        ipc_cb = info[1].As<Napi::Function>();
        has_ipc_cb = true;
    }

    int window_id = g_next_window_id++;
    auto instance = std::make_shared<WindowInstance>();
    instance->id = window_id;
    instance->title = title;
    instance->width = width;
    instance->height = height;
    instance->url = url;
    instance->html = html;
    instance->resizable = resizable;
    instance->minWidth = minWidth;
    instance->minHeight = minHeight;
    instance->maxWidth = maxWidth;
    instance->maxHeight = maxHeight;
    instance->lowEndDeviceMode = lowEndDeviceMode;
    instance->privacyShield = privacyShield;

    if (has_ipc_cb) {
        instance->tsfn = Napi::ThreadSafeFunction::New(
            env,
            ipc_cb,
            "Adrenaline IPC TSFN",
            0,
            1
        );
        instance->has_tsfn = true;
    }

    {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        windows_map()[window_id] = instance;
    }

#if ADREN_FEATURE_CEF
    {
        std::lock_guard<std::mutex> lock(g_all_windows_mutex);
        all_windows().push_back(instance);
    }
#endif

    // The engine (webview or CEF) is created on the shared engine thread; the
    // JS thread only posts this setup task and returns the window id.
    EnsureEngineThread();
#if ADREN_FEATURE_CEF
    PushEngineTask([instance]() {
        try {
            if (!EnsureCefInitialized()) {
                std::cerr << "Adrenaline: CefInitialize failed" << std::endl;
                return;
            }

            std::string initial_url = instance->url;
            if (!instance->html.empty()) {
                std::string encoded =
                    CefBase64Encode(instance->html.data(), instance->html.size()).ToString();
                initial_url = "data:text/html;base64," + encoded;
            }

            // `data:` (from `html`) is local; only a caller-supplied remote `url`
            // can trip the guard.
            if (RejectRemoteUrl(initial_url)) {
                return;
            }

            auto on_ipc = [instance](const std::string& channel, const std::string& data) {
                if (!instance->has_tsfn || instance->tsfn_released) {
                    return;
                }
                // The webview path marshals a single JSON array string; reuse the
                // same shape so the JS side needs no CEF-specific branch.
                std::string* raw_req = new std::string("[" + channel + "," + data + "]");
                napi_status status = instance->tsfn.NonBlockingCall(raw_req, [](Napi::Env env, Napi::Function jsCallback, std::string* payload) {
                    if (env != nullptr && jsCallback != nullptr && payload != nullptr) {
                        Napi::HandleScope scope(env);
                        Napi::Object global = env.Global();
                        Napi::Object jsonObj = global.Get("JSON").As<Napi::Object>();
                        Napi::Function parseFn = jsonObj.Get("parse").As<Napi::Function>();

                        Napi::Value parsed;
                        try {
                            parsed = parseFn.Call(jsonObj, { Napi::String::New(env, *payload) });
                        } catch (...) {
                            parsed = env.Null();
                        }

                        Napi::Value channelVal = env.Undefined();
                        Napi::Value dataVal = env.Undefined();
                        if (parsed.IsArray()) {
                            Napi::Array arr = parsed.As<Napi::Array>();
                            if (arr.Length() > 0) channelVal = arr.Get((uint32_t)0);
                            if (arr.Length() > 1) dataVal = arr.Get((uint32_t)1);
                        }
                        jsCallback.Call({ channelVal, dataVal });
                    }
                    delete payload;
                });
                if (status != napi_ok) {
                    delete raw_req;
                }
            };

            CefRefPtr<AdrenalineClient> client(
                new AdrenalineClient(on_ipc, [instance]() {
                    // Runs from OnBeforeClose: drop the parked reference so
                    // CefShutdown() sees the browser as fully torn down.
                    instance->browser_closed = true;
                    instance->browser = nullptr;
                }));

            CefBrowserSettings browser_settings;

            CefRefPtr<CefBrowserView> browser_view = CefBrowserView::CreateBrowserView(
                client, initial_url.empty() ? "about:blank" : initial_url,
                browser_settings, nullptr, nullptr, nullptr);
            if (!browser_view.get()) {
                std::cerr << "Adrenaline: CreateBrowserView failed" << std::endl;
                return;
            }

            CefRefPtr<CefWindow> window = CefWindow::CreateTopLevelWindow(nullptr);
            if (!window.get()) {
                std::cerr << "Adrenaline: CreateTopLevelWindow failed" << std::endl;
                return;
            }
            window->SetTitle(instance->title);
            window->SetBounds(CefRect(0, 0, instance->width, instance->height));
            window->AddChildView(browser_view);
            window->Show();

            instance->window = window;
            instance->browser = browser_view->GetBrowser();
        } catch (const std::exception& e) {
            std::cerr << "Adrenaline Window Exception: " << e.what() << std::endl;
        } catch (...) {
            std::cerr << "Adrenaline Window Unknown Exception" << std::endl;
        }
    });
#else
    PushEngineTask([instance]() {
        try {
            bool debug_flag = false;
#if ADREN_FEATURE_DEVTOOLS
            debug_flag = true;
#endif
            auto wv = std::make_shared<webview::webview>(debug_flag, nullptr);
            wv->set_title(instance->title.c_str());

            webview_hint_t hint = instance->resizable ? WEBVIEW_HINT_NONE : WEBVIEW_HINT_FIXED;
            wv->set_size(instance->width, instance->height, hint);
            if (instance->minWidth > 0 || instance->minHeight > 0) {
                wv->set_size(instance->minWidth, instance->minHeight, WEBVIEW_HINT_MIN);
            }
            if (instance->maxWidth > 0 || instance->maxHeight > 0) {
                wv->set_size(instance->maxWidth, instance->maxHeight, WEBVIEW_HINT_MAX);
            }

            wv->bind("__adrenaline_ipc_send", [instance](const std::string& seq, const std::string& req, void* /*arg*/) {
                if (instance->wv) {
                    instance->wv->resolve(seq, 0, "null");
                }
                if (instance->has_tsfn && !instance->tsfn_released) {
                    std::string* raw_req = new std::string(req);
                    napi_status status = instance->tsfn.NonBlockingCall(raw_req, [](Napi::Env env, Napi::Function jsCallback, std::string* data) {
                        if (env != nullptr && jsCallback != nullptr && data != nullptr) {
                            Napi::HandleScope scope(env);

                            Napi::Object global = env.Global();
                            Napi::Object jsonObj = global.Get("JSON").As<Napi::Object>();
                            Napi::Function parseFn = jsonObj.Get("parse").As<Napi::Function>();

                            Napi::Value parsedReqVal;
                            try {
                                parsedReqVal = parseFn.Call(jsonObj, { Napi::String::New(env, *data) });
                            } catch (...) {
                                parsedReqVal = env.Null();
                            }

                            Napi::Value channelVal = env.Undefined();
                            Napi::Value dataVal = env.Undefined();

                            if (parsedReqVal.IsArray()) {
                                Napi::Array arr = parsedReqVal.As<Napi::Array>();
                                if (arr.Length() > 0) {
                                    channelVal = arr.Get((uint32_t)0);
                                }
                                if (arr.Length() > 1) {
                                    dataVal = arr.Get((uint32_t)1);
                                }
                            }

                            jsCallback.Call({ channelVal, dataVal });
                        }
                        delete data;
                    });
                    if (status != napi_ok) {
                        delete raw_req;
                    }
                }
            }, nullptr);

            std::string init_script = R"raw(
                window.adrenaline = window.adrenaline || {};
                window.adrenaline.send = function(channel, data) { return window.__adrenaline_ipc_send(channel, data); };
                window.adrenaline._listeners = window.adrenaline._listeners || {};
                window.adrenaline.on = function(channel, cb) {
                    window.adrenaline._listeners[channel] = window.adrenaline._listeners[channel] || [];
                    window.adrenaline._listeners[channel].push(cb);
                };
                window.adrenaline._onMessage = function(channel, data) {
                    var cbs = window.adrenaline._listeners[channel];
                    if (cbs) {
                        cbs.slice().forEach(function(cb) { cb(data); });
                    }
                };
                window.__adrenaline_callbacks = window.__adrenaline_callbacks || {};
                window.__adrenaline_ipc_reply = function(reqId, err, result) {
                    if (window.__adrenaline_callbacks[reqId]) {
                        if (err) window.__adrenaline_callbacks[reqId].reject(new Error(err));
                        else window.__adrenaline_callbacks[reqId].resolve(result);
                        delete window.__adrenaline_callbacks[reqId];
                    }
                };
                window.adrenaline.invoke = function(channel, data) {
                    return new Promise(function(resolve, reject) {
                        var reqId = Math.random().toString(36).substring(2) + Date.now();
                        window.__adrenaline_callbacks[reqId] = { resolve: resolve, reject: reject };
                        window.adrenaline.send('__adrenaline_ipc_invoke', { reqId: reqId, channel: channel, data: data });
                    });
                };
            )raw";

            if (instance->privacyShield) {
                init_script += R"raw(
                    if (navigator && navigator.sendBeacon) {
                        navigator.sendBeacon = function() { return true; };
                    }
                )raw";
            }

            wv->init(init_script.c_str());

            if (!instance->html.empty()) {
                wv->set_html(instance->html.c_str());
            } else if (!instance->url.empty()) {
                wv->navigate(instance->url.c_str());
            }

            instance->wv = std::move(wv);
        } catch (const std::exception& e) {
            std::cerr << "Adrenaline Window Exception: " << e.what() << std::endl;
            instance->wv.reset();
        } catch (...) {
            std::cerr << "Adrenaline Window Unknown Exception" << std::endl;
            instance->wv.reset();
        }
    });
#endif

    return Napi::Number::New(env, window_id);
}

Napi::Value CloseWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Window ID expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    int window_id = info[0].As<Napi::Number>().Int32Value();
    std::shared_ptr<WindowInstance> instance;

    {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        auto it = windows_map().find(window_id);
        if (it != windows_map().end()) {
            instance = it->second;
            windows_map().erase(it);
        }
    }

    if (instance) {
        if (instance->has_tsfn && !instance->tsfn_released.exchange(true)) {
            instance->tsfn.Release();
        }
#if ADREN_FEATURE_CEF
        RunOnEngine([instance]() {
            if (instance->browser) {
                instance->browser->GetHost()->CloseBrowser(false);
            }
        });
#endif
        // WebKit aborts when a webview is torn down, even after draining, so a
        // closed window's instance is parked here instead of destroyed. The OS
        // reclaims it at process exit; this keeps close() crash-free.
        {
            std::lock_guard<std::mutex> lock(g_closed_mutex);
            closed_windows().push_back(instance);
        }
        return Napi::Boolean::New(env, true);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value EvalWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected window ID (number) and script (string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    int window_id = info[0].As<Napi::Number>().Int32Value();
    std::string script = info[1].As<Napi::String>().Utf8Value();

    std::shared_ptr<WindowInstance> instance;
    {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        auto it = windows_map().find(window_id);
        if (it != windows_map().end()) {
            instance = it->second;
        }
    }

    if (instance) {
        RunOnEngine([instance, script]() {
#if ADREN_FEATURE_CEF
            if (instance->browser && instance->browser->GetMainFrame()) {
                instance->browser->GetMainFrame()->ExecuteJavaScript(script, "", 0);
            }
#else
            if (instance->wv) {
                instance->wv->eval(script);
            }
#endif
        });
        return Napi::Boolean::New(env, true);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value NavigateWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected window ID (number) and URL (string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    int window_id = info[0].As<Napi::Number>().Int32Value();
    std::string url = info[1].As<Napi::String>().Utf8Value();

    std::shared_ptr<WindowInstance> instance;
    {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        auto it = windows_map().find(window_id);
        if (it != windows_map().end()) {
            instance = it->second;
        }
    }

    if (instance) {
#if ADREN_FEATURE_CEF
        // Same local-URL policy as CreateWindow: single-process mode must not
        // navigate to remote content.
        if (RejectRemoteUrl(url)) {
            return Napi::Boolean::New(env, false);
        }
#endif
        instance->url = url;
        RunOnEngine([instance, url]() {
#if ADREN_FEATURE_CEF
            if (instance->browser && instance->browser->GetMainFrame()) {
                instance->browser->GetMainFrame()->LoadURL(url);
            }
#else
            if (instance->wv) {
                instance->wv->navigate(url);
            }
#endif
        });
        return Napi::Boolean::New(env, true);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value ShutdownCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    ShutdownWindows();
    return env.Undefined();
}

void ShutdownWindows() {
    if (!engine().started) {
        return;
    }

    // Runs from the JS process 'exit' hook (index.js), which blocks until it
    // returns. Exiting while WebKit is still loading leaves JSC state that
    // segfaults during node's own teardown, so let pending loads settle first.
    // Windows still open here are deliberately not destroyed: tearing a webview
    // down at exit aborts even after draining, and the OS reclaims it anyway.
    RunOnEngine([]() {
#if ADREN_FEATURE_CEF
        // CEF requires every browser to be gone before CefShutdown(). Close both
        // live windows and any window already removed from windows_map() by
        // CloseWindow (parked in all_windows()), then wait for each browser's
        // OnBeforeClose callback instead of relying on a fixed drain timeout.
        std::vector<std::shared_ptr<WindowInstance>> snapshot;
        {
            std::lock_guard<std::mutex> lock(g_all_windows_mutex);
            snapshot = all_windows();
        }
        for (auto& instance : snapshot) {
            if (instance->browser) {
                instance->browser->GetHost()->CloseBrowser(true);
            }
        }

        auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        while (std::chrono::steady_clock::now() < deadline) {
            bool all_closed = true;
            for (auto& instance : snapshot) {
                // Only wait on browsers that were actually created; a window whose
                // creation failed has no browser and nothing to close.
                if (instance->browser && !instance->browser_closed) {
                    all_closed = false;
                    break;
                }
            }
            if (all_closed) {
                break;
            }
            CefDoMessageLoopWork();
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        CefShutdown();
        RemoveCefCacheDir(ResolveCefCacheDir());
#else
        DrainEngine(500);
#endif
    });

    // Stop and join the engine thread so it cannot outlive the process.
    {
        std::lock_guard<std::mutex> lock(engine().mutex);
        engine().stop = true;
    }
#if ADREN_FEATURE_CEF
    // The CEF pump polls on its own; nothing to wake.
#else
    g_main_context_wakeup(g_main_context_default());
#endif
    if (engine().thread.joinable()) {
        engine().thread.join();
    }
    engine().started = false;
}

} // namespace Adrenaline
