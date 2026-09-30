#include "window.h"
#include "vendor/webview.h"

#include <thread>
#include <mutex>
#include <unordered_map>
#include <memory>
#include <atomic>
#include <string>
#include <iostream>

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

    webview::webview* wv{nullptr};
    std::thread th;
    std::atomic<bool> is_running{false};

    Napi::ThreadSafeFunction tsfn;
    bool has_tsfn{false};
    std::atomic<bool> tsfn_released{false};
};

static std::atomic<int> g_next_window_id{1};
static std::unordered_map<int, std::shared_ptr<WindowInstance>> g_windows;
static std::mutex g_windows_mutex;

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
        g_windows[window_id] = instance;
    }

    instance->th = std::thread([instance]() {
        try {
            webview::webview wv(false, nullptr);
            wv.set_title(instance->title.c_str());

            webview_hint_t hint = instance->resizable ? WEBVIEW_HINT_NONE : WEBVIEW_HINT_FIXED;
            wv.set_size(instance->width, instance->height, hint);
            if (instance->minWidth > 0 || instance->minHeight > 0) {
                wv.set_size(instance->minWidth, instance->minHeight, WEBVIEW_HINT_MIN);
            }
            if (instance->maxWidth > 0 || instance->maxHeight > 0) {
                wv.set_size(instance->maxWidth, instance->maxHeight, WEBVIEW_HINT_MAX);
            }

            wv.bind("__adrenaline_ipc_send", [instance](const std::string& seq, const std::string& req, void* /*arg*/) {
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

            wv.init(R"raw(
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
            )raw");

            if (!instance->html.empty()) {
                wv.set_html(instance->html.c_str());
            } else if (!instance->url.empty()) {
                wv.navigate(instance->url.c_str());
            }

            instance->wv = &wv;
            instance->is_running = true;
            wv.run();
            instance->is_running = false;
            instance->wv = nullptr;
        } catch (const std::exception& e) {
            std::cerr << "Adrenaline Window Exception: " << e.what() << std::endl;
            instance->is_running = false;
            instance->wv = nullptr;
        } catch (...) {
            std::cerr << "Adrenaline Window Unknown Exception" << std::endl;
            instance->is_running = false;
            instance->wv = nullptr;
        }

        if (instance->has_tsfn && !instance->tsfn_released.exchange(true)) {
            instance->tsfn.Release();
        }
    });

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
        auto it = g_windows.find(window_id);
        if (it != g_windows.end()) {
            instance = it->second;
            g_windows.erase(it);
        }
    }

    if (instance) {
        if (instance->wv) {
            instance->wv->dispatch([instance]() {
                if (instance->wv) {
                    instance->wv->terminate();
                }
            });
        }
        if (instance->has_tsfn && !instance->tsfn_released.exchange(true)) {
            instance->tsfn.Release();
        }
        if (instance->th.joinable()) {
            instance->th.join();
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
        auto it = g_windows.find(window_id);
        if (it != g_windows.end()) {
            instance = it->second;
        }
    }

    if (instance) {
        if (instance->wv) {
            std::string script_copy = script;
            instance->wv->dispatch([instance, script_copy]() {
                if (instance->wv) {
                    instance->wv->eval(script_copy);
                }
            });
            return Napi::Boolean::New(env, true);
        }
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
        auto it = g_windows.find(window_id);
        if (it != g_windows.end()) {
            instance = it->second;
        }
    }

    if (instance) {
        instance->url = url;
        if (instance->wv) {
            std::string url_copy = url;
            instance->wv->dispatch([instance, url_copy]() {
                if (instance->wv) {
                    instance->wv->navigate(url_copy);
                }
            });
            return Napi::Boolean::New(env, true);
        }
        return Napi::Boolean::New(env, true);
    }

    return Napi::Boolean::New(env, false);
}

} // namespace Adrenaline
