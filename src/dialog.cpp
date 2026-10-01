#include "dialog.h"
#include <vector>
#include <string>
#include <cstdlib>
#include <mutex>

#if defined(_WIN32)
#include <windows.h>
#include <commdlg.h>
static std::wstring Utf8ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size_needed = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), NULL, 0);
    std::wstring wstrTo(size_needed, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), &wstrTo[0], size_needed);
    return wstrTo;
}

static std::string WideToUtf8(const std::wstring& wstr) {
    if (wstr.empty()) return "";
    int size_needed = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), (int)wstr.size(), NULL, 0, NULL, NULL);
    std::string strTo(size_needed, 0);
    WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), (int)wstr.size(), &strTo[0], size_needed, NULL, NULL);
    return strTo;
}
#elif defined(__APPLE__)
#import <Cocoa/Cocoa.h>
#else
#include <gtk/gtk.h>

static std::mutex g_gtk_mutex;

static bool EnsureGtkInit() {
    std::lock_guard<std::mutex> lock(g_gtk_mutex);
    static bool initialized = false;
    static bool result = false;
    if (!initialized) {
        initialized = true;
        result = gtk_init_check(nullptr, nullptr);
    }
    return result;
}

static gboolean OnGtkTestTimeout(gpointer user_data) {
    GtkDialog* dialog = GTK_DIALOG(user_data);
    gtk_dialog_response(dialog, GTK_RESPONSE_CANCEL);
    return FALSE;
}
#endif

namespace Adrenaline {

struct FileFilter {
    std::string name;
    std::vector<std::string> extensions;
};

static std::vector<FileFilter> ParseFilters(const Napi::Value& val) {
    std::vector<FileFilter> filters;
    if (val.IsArray()) {
        Napi::Array arr = val.As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            Napi::Value item = arr.Get(i);
            if (item.IsObject()) {
                Napi::Object filterObj = item.As<Napi::Object>();
                FileFilter filter;
                if (filterObj.Has("name") && filterObj.Get("name").IsString()) {
                    filter.name = filterObj.Get("name").As<Napi::String>().Utf8Value();
                }
                if (filterObj.Has("extensions") && filterObj.Get("extensions").IsArray()) {
                    Napi::Array exts = filterObj.Get("extensions").As<Napi::Array>();
                    for (uint32_t j = 0; j < exts.Length(); ++j) {
                        Napi::Value extVal = exts.Get(j);
                        if (extVal.IsString()) {
                            filter.extensions.push_back(extVal.As<Napi::String>().Utf8Value());
                        }
                    }
                }
                filters.push_back(filter);
            }
        }
    }
    return filters;
}

static int CheckTestTimeout(const Napi::Object& opts) {
    if (opts.Has("_testTimeout") && opts.Get("_testTimeout").IsNumber()) {
        return opts.Get("_testTimeout").As<Napi::Number>().Int32Value();
    }
    const char* envTest = std::getenv("ADRENALINE_TEST_MODE");
    if (envTest && std::string(envTest) == "1") {
        return 100;
    }
    return 0;
}

class OpenDialogWorker : public Napi::AsyncWorker {
public:
    OpenDialogWorker(Napi::Env env,
                     Napi::Promise::Deferred deferred,
                     std::string title,
                     std::string defaultPath,
                     std::string buttonLabel,
                     std::vector<FileFilter> filters,
                     std::vector<std::string> properties,
                     int testTimeout)
        : Napi::AsyncWorker(env),
          m_deferred(deferred),
          m_title(title),
          m_defaultPath(defaultPath),
          m_buttonLabel(buttonLabel),
          m_filters(filters),
          m_properties(properties),
          m_testTimeout(testTimeout) {}

    void Execute() override {
#if defined(_WIN32)
        if (m_testTimeout > 0) {
            m_canceled = true;
            return;
        }
        bool multiSelections = false;
        for (const auto& p : m_properties) {
            if (p == "multiSelections") multiSelections = true;
        }

        wchar_t szFile[32768] = {0};
        if (!m_defaultPath.empty()) {
            std::wstring wPath = Utf8ToWide(m_defaultPath);
            wcsncpy(szFile, wPath.c_str(), sizeof(szFile)/sizeof(wchar_t) - 1);
        }

        OPENFILENAMEW ofn;
        ZeroMemory(&ofn, sizeof(ofn));
        ofn.lStructSize = sizeof(ofn);
        ofn.hwndOwner = GetActiveWindow();
        ofn.lpstrFile = szFile;
        ofn.nMaxFile = sizeof(szFile) / sizeof(wchar_t);

        std::wstring wTitle = Utf8ToWide(m_title);
        if (!wTitle.empty()) ofn.lpstrTitle = wTitle.c_str();

        std::wstring filterStr;
        for (const auto& filter : m_filters) {
            std::wstring wName = Utf8ToWide(filter.name);
            filterStr += wName + L"\0";
            std::wstring extStr;
            for (size_t i = 0; i < filter.extensions.size(); ++i) {
                if (i > 0) extStr += L";";
                extStr += L"*." + Utf8ToWide(filter.extensions[i]);
            }
            if (extStr.empty()) extStr = L"*.*";
            filterStr += extStr + L"\0";
        }
        if (filterStr.empty()) {
            filterStr = L"All Files (*.*)\0*.*\0\0";
        } else {
            filterStr += L"\0";
        }
        ofn.lpstrFilter = filterStr.c_str();
        ofn.nFilterIndex = 1;

        ofn.Flags = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR;
        if (multiSelections) {
            ofn.Flags |= OFN_ALLOWMULTISELECT | OFN_EXPLORER;
        }

        if (GetOpenFileNameW(&ofn)) {
            m_canceled = false;
            if (multiSelections) {
                wchar_t* p = szFile;
                std::wstring dir = p;
                p += dir.length() + 1;
                if (*p == L'\0') {
                    m_filePaths.push_back(WideToUtf8(dir));
                } else {
                    while (*p != L'\0') {
                        std::wstring fullPath = dir + L"\\" + p;
                        m_filePaths.push_back(WideToUtf8(fullPath));
                        p += wcslen(p) + 1;
                    }
                }
            } else {
                m_filePaths.push_back(WideToUtf8(szFile));
            }
        } else {
            m_canceled = true;
        }

#elif defined(__APPLE__)
        if (m_testTimeout > 0) {
            m_canceled = true;
            return;
        }
        @autoreleasepool {
            NSOpenPanel *panel = [NSOpenPanel openPanel];
            if (!m_title.empty()) {
                [panel setTitle:[NSString stringWithUTF8String:m_title.c_str()]];
            }
            if (!m_buttonLabel.empty()) {
                [panel setPrompt:[NSString stringWithUTF8String:m_buttonLabel.c_str()]];
            }
            bool openDirectory = false;
            bool multiSelections = false;
            for (const auto& p : m_properties) {
                if (p == "openDirectory") openDirectory = true;
                if (p == "multiSelections") multiSelections = true;
            }
            [panel setCanChooseFiles:!openDirectory];
            [panel setCanChooseDirectories:openDirectory];
            [panel setAllowsMultipleSelection:multiSelections];

            if (!m_defaultPath.empty()) {
                NSString *pathStr = [NSString stringWithUTF8String:m_defaultPath.c_str()];
                [panel setDirectoryURL:[NSURL fileURLWithPath:pathStr]];
            }

            if (!m_filters.empty()) {
                NSMutableArray *allowedExts = [NSMutableArray array];
                for (const auto& filter : m_filters) {
                    for (const auto& ext : filter.extensions) {
                        [allowedExts addObject:[NSString stringWithUTF8String:ext.c_str()]];
                    }
                }
                [panel setAllowedFileTypes:allowedExts];
            }

            NSModalResponse result = [panel runModal];
            if (result == NSModalResponseOK) {
                m_canceled = false;
                for (NSURL *url in [panel URLs]) {
                    m_filePaths.push_back([[url path] UTF8String]);
                }
            } else {
                m_canceled = true;
            }
        }

#else
        if (!EnsureGtkInit()) {
            m_canceled = true;
            return;
        }

        std::lock_guard<std::mutex> lock(g_gtk_mutex);

        bool openDirectory = false;
        bool multiSelections = false;
        for (const auto& prop : m_properties) {
            if (prop == "openDirectory") openDirectory = true;
            if (prop == "multiSelections") multiSelections = true;
        }

        GtkFileChooserAction action = openDirectory ? GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER : GTK_FILE_CHOOSER_ACTION_OPEN;

        GtkWidget* dialog = gtk_file_chooser_dialog_new(
            m_title.empty() ? "Open" : m_title.c_str(),
            NULL,
            action,
            "_Cancel", GTK_RESPONSE_CANCEL,
            m_buttonLabel.empty() ? "_Open" : m_buttonLabel.c_str(), GTK_RESPONSE_ACCEPT,
            NULL
        );

        if (multiSelections) {
            gtk_file_chooser_set_select_multiple(GTK_FILE_CHOOSER(dialog), TRUE);
        }

        if (!m_defaultPath.empty()) {
            gtk_file_chooser_set_filename(GTK_FILE_CHOOSER(dialog), m_defaultPath.c_str());
        }

        for (const auto& filter : m_filters) {
            GtkFileFilter* gtkFilter = gtk_file_filter_new();
            if (!filter.name.empty()) {
                gtk_file_filter_set_name(gtkFilter, filter.name.c_str());
            }
            for (const auto& ext : filter.extensions) {
                std::string pattern = "*." + ext;
                gtk_file_filter_add_pattern(gtkFilter, pattern.c_str());
            }
            gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(dialog), gtkFilter);
        }

        if (m_testTimeout > 0) {
            g_timeout_add(m_testTimeout, OnGtkTestTimeout, dialog);
        }

        gint res = gtk_dialog_run(GTK_DIALOG(dialog));
        if (res == GTK_RESPONSE_ACCEPT) {
            m_canceled = false;
            if (multiSelections) {
                GSList* filenames = gtk_file_chooser_get_filenames(GTK_FILE_CHOOSER(dialog));
                for (GSList* iter = filenames; iter != NULL; iter = iter->next) {
                    char* filename = (char*)iter->data;
                    if (filename) {
                        m_filePaths.push_back(filename);
                        g_free(filename);
                    }
                }
                g_slist_free(filenames);
            } else {
                char* filename = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
                if (filename) {
                    m_filePaths.push_back(filename);
                    g_free(filename);
                }
            }
        } else {
            m_canceled = true;
        }

        gtk_widget_destroy(dialog);
        while (gtk_events_pending()) gtk_main_iteration();
#endif
    }

    void OnOK() override {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);

        Napi::Object result = Napi::Object::New(env);
        result.Set("canceled", Napi::Boolean::New(env, m_canceled));

        Napi::Array pathsArr = Napi::Array::New(env, m_filePaths.size());
        for (size_t i = 0; i < m_filePaths.size(); ++i) {
            pathsArr.Set(i, Napi::String::New(env, m_filePaths[i]));
        }
        result.Set("filePaths", pathsArr);

        m_deferred.Resolve(result);
    }

    void OnError(const Napi::Error& error) override {
        m_deferred.Reject(error.Value());
    }

private:
    Napi::Promise::Deferred m_deferred;
    std::string m_title;
    std::string m_defaultPath;
    std::string m_buttonLabel;
    std::vector<FileFilter> m_filters;
    std::vector<std::string> m_properties;
    int m_testTimeout{0};

    bool m_canceled{true};
    std::vector<std::string> m_filePaths;
};

class SaveDialogWorker : public Napi::AsyncWorker {
public:
    SaveDialogWorker(Napi::Env env,
                     Napi::Promise::Deferred deferred,
                     std::string title,
                     std::string defaultPath,
                     std::string buttonLabel,
                     std::vector<FileFilter> filters,
                     int testTimeout)
        : Napi::AsyncWorker(env),
          m_deferred(deferred),
          m_title(title),
          m_defaultPath(defaultPath),
          m_buttonLabel(buttonLabel),
          m_filters(filters),
          m_testTimeout(testTimeout) {}

    void Execute() override {
#if defined(_WIN32)
        if (m_testTimeout > 0) {
            m_canceled = true;
            m_filePath = "";
            return;
        }
        wchar_t szFile[260] = {0};
        if (!m_defaultPath.empty()) {
            std::wstring wPath = Utf8ToWide(m_defaultPath);
            wcsncpy(szFile, wPath.c_str(), sizeof(szFile)/sizeof(wchar_t) - 1);
        }

        OPENFILENAMEW ofn;
        ZeroMemory(&ofn, sizeof(ofn));
        ofn.lStructSize = sizeof(ofn);
        ofn.hwndOwner = GetActiveWindow();
        ofn.lpstrFile = szFile;
        ofn.nMaxFile = sizeof(szFile) / sizeof(wchar_t);

        std::wstring wTitle = Utf8ToWide(m_title);
        if (!wTitle.empty()) ofn.lpstrTitle = wTitle.c_str();

        std::wstring filterStr;
        for (const auto& filter : m_filters) {
            std::wstring wName = Utf8ToWide(filter.name);
            filterStr += wName + L"\0";
            std::wstring extStr;
            for (size_t i = 0; i < filter.extensions.size(); ++i) {
                if (i > 0) extStr += L";";
                extStr += L"*." + Utf8ToWide(filter.extensions[i]);
            }
            if (extStr.empty()) extStr = L"*.*";
            filterStr += extStr + L"\0";
        }
        if (filterStr.empty()) {
            filterStr = L"All Files (*.*)\0*.*\0\0";
        } else {
            filterStr += L"\0";
        }
        ofn.lpstrFilter = filterStr.c_str();
        ofn.nFilterIndex = 1;
        ofn.Flags = OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR;

        if (GetSaveFileNameW(&ofn)) {
            m_canceled = false;
            m_filePath = WideToUtf8(szFile);
        } else {
            m_canceled = true;
        }

#elif defined(__APPLE__)
        if (m_testTimeout > 0) {
            m_canceled = true;
            m_filePath = "";
            return;
        }
        @autoreleasepool {
            NSSavePanel *panel = [NSSavePanel savePanel];
            if (!m_title.empty()) {
                [panel setTitle:[NSString stringWithUTF8String:m_title.c_str()]];
            }
            if (!m_buttonLabel.empty()) {
                [panel setPrompt:[NSString stringWithUTF8String:m_buttonLabel.c_str()]];
            }
            if (!m_defaultPath.empty()) {
                NSString *pathStr = [NSString stringWithUTF8String:m_defaultPath.c_str()];
                [panel setDirectoryURL:[NSURL fileURLWithPath:pathStr]];
            }
            if (!m_filters.empty()) {
                NSMutableArray *allowedExts = [NSMutableArray array];
                for (const auto& filter : m_filters) {
                    for (const auto& ext : filter.extensions) {
                        [allowedExts addObject:[NSString stringWithUTF8String:ext.c_str()]];
                    }
                }
                [panel setAllowedFileTypes:allowedExts];
            }

            NSModalResponse result = [panel runModal];
            if (result == NSModalResponseOK) {
                m_canceled = false;
                if ([panel URL]) {
                    m_filePath = [[[panel URL] path] UTF8String];
                }
            } else {
                m_canceled = true;
            }
        }

#else
        if (!EnsureGtkInit()) {
            m_canceled = true;
            return;
        }

        std::lock_guard<std::mutex> lock(g_gtk_mutex);

        GtkWidget* dialog = gtk_file_chooser_dialog_new(
            m_title.empty() ? "Save" : m_title.c_str(),
            NULL,
            GTK_FILE_CHOOSER_ACTION_SAVE,
            "_Cancel", GTK_RESPONSE_CANCEL,
            m_buttonLabel.empty() ? "_Save" : m_buttonLabel.c_str(), GTK_RESPONSE_ACCEPT,
            NULL
        );

        gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(dialog), TRUE);

        if (!m_defaultPath.empty()) {
            gtk_file_chooser_set_filename(GTK_FILE_CHOOSER(dialog), m_defaultPath.c_str());
        }

        for (const auto& filter : m_filters) {
            GtkFileFilter* gtkFilter = gtk_file_filter_new();
            if (!filter.name.empty()) {
                gtk_file_filter_set_name(gtkFilter, filter.name.c_str());
            }
            for (const auto& ext : filter.extensions) {
                std::string pattern = "*." + ext;
                gtk_file_filter_add_pattern(gtkFilter, pattern.c_str());
            }
            gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(dialog), gtkFilter);
        }

        if (m_testTimeout > 0) {
            g_timeout_add(m_testTimeout, OnGtkTestTimeout, dialog);
        }

        gint res = gtk_dialog_run(GTK_DIALOG(dialog));
        if (res == GTK_RESPONSE_ACCEPT) {
            m_canceled = false;
            char* filename = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
            if (filename) {
                m_filePath = filename;
                g_free(filename);
            }
        } else {
            m_canceled = true;
        }

        gtk_widget_destroy(dialog);
        while (gtk_events_pending()) gtk_main_iteration();
#endif
    }

    void OnOK() override {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);

        Napi::Object result = Napi::Object::New(env);
        result.Set("canceled", Napi::Boolean::New(env, m_canceled));
        result.Set("filePath", Napi::String::New(env, m_filePath));

        m_deferred.Resolve(result);
    }

    void OnError(const Napi::Error& error) override {
        m_deferred.Reject(error.Value());
    }

private:
    Napi::Promise::Deferred m_deferred;
    std::string m_title;
    std::string m_defaultPath;
    std::string m_buttonLabel;
    std::vector<FileFilter> m_filters;
    int m_testTimeout{0};

    bool m_canceled{true};
    std::string m_filePath;
};

class MessageBoxWorker : public Napi::AsyncWorker {
public:
    MessageBoxWorker(Napi::Env env,
                     Napi::Promise::Deferred deferred,
                     std::string type,
                     std::vector<std::string> buttons,
                     int defaultId,
                     std::string title,
                     std::string message,
                     std::string detail,
                     std::string checkboxLabel,
                     bool checkboxChecked,
                     int testTimeout)
        : Napi::AsyncWorker(env),
          m_deferred(deferred),
          m_type(type),
          m_buttons(buttons),
          m_defaultId(defaultId),
          m_title(title),
          m_message(message),
          m_detail(detail),
          m_checkboxLabel(checkboxLabel),
          m_checkboxChecked(checkboxChecked),
          m_testTimeout(testTimeout) {}

    void Execute() override {
#if defined(_WIN32)
        if (m_testTimeout > 0) {
            m_response = m_defaultId;
            return;
        }
        std::wstring wText = Utf8ToWide(m_message);
        if (!m_detail.empty()) {
            if (!wText.empty()) wText += L"\n\n";
            wText += Utf8ToWide(m_detail);
        }
        std::wstring wCaption = Utf8ToWide(m_title);

        UINT uType = MB_OK;
        if (m_type == "error") uType |= MB_ICONERROR;
        else if (m_type == "warning") uType |= MB_ICONWARNING;
        else if (m_type == "question") uType |= MB_ICONQUESTION;
        else uType |= MB_ICONINFORMATION;

        if (m_buttons.size() == 2 && m_buttons[0] == "OK" && m_buttons[1] == "Cancel") {
            uType |= MB_OKCANCEL;
        } else if (m_buttons.size() == 2 && (m_buttons[0] == "Yes" || m_buttons[0] == "yes")) {
            uType |= MB_YESNO;
        } else if (m_buttons.size() == 3) {
            uType |= MB_YESNOCANCEL;
        }

        int result = MessageBoxW(GetActiveWindow(), wText.c_str(), wCaption.c_str(), uType);
        if (result == IDOK || result == IDYES) m_response = 0;
        else if (result == IDCANCEL && m_buttons.size() == 2) m_response = 1;
        else if (result == IDNO) m_response = 1;
        else if (result == IDCANCEL && m_buttons.size() == 3) m_response = 2;
        else m_response = 0;

#elif defined(__APPLE__)
        if (m_testTimeout > 0) {
            m_response = m_defaultId;
            return;
        }
        @autoreleasepool {
            NSAlert *alert = [[NSAlert alloc] init];
            if (!m_title.empty()) {
                [alert setMessageText:[NSString stringWithUTF8String:m_title.c_str()]];
            }
            if (!m_message.empty()) {
                [alert setInformativeText:[NSString stringWithUTF8String:m_message.c_str()]];
            }
            if (m_buttons.empty()) {
                [alert addButtonWithTitle:@"OK"];
            } else {
                for (const auto& btn : m_buttons) {
                    [alert addButtonWithTitle:[NSString stringWithUTF8String:btn.c_str()]];
                }
            }
            if (!m_checkboxLabel.empty()) {
                NSButton *checkbox = [NSButton checkboxWithTitle:[NSString stringWithUTF8String:m_checkboxLabel.c_str()] target:nil action:nil];
                [checkbox setState:m_checkboxChecked ? NSControlStateValueOn : NSControlStateValueOff];
                [alert setAccessoryView:checkbox];
            }

            NSModalResponse responseCode = [alert runModal];
            m_response = (int)(responseCode - NSAlertFirstButtonReturn);
            if (m_response < 0) m_response = 0;

            if (!m_checkboxLabel.empty()) {
                NSButton *checkbox = (NSButton *)[alert accessoryView];
                m_checkboxChecked = ([checkbox state] == NSControlStateValueOn);
            }
        }

#else
        if (!EnsureGtkInit()) {
            m_response = m_defaultId;
            return;
        }

        std::lock_guard<std::mutex> lock(g_gtk_mutex);

        GtkMessageType msgType = GTK_MESSAGE_INFO;
        if (m_type == "error") msgType = GTK_MESSAGE_ERROR;
        else if (m_type == "warning") msgType = GTK_MESSAGE_WARNING;
        else if (m_type == "question") msgType = GTK_MESSAGE_QUESTION;
        else if (m_type == "none") msgType = GTK_MESSAGE_OTHER;

        GtkWidget* dialog = gtk_message_dialog_new(
            NULL,
            GTK_DIALOG_MODAL,
            msgType,
            GTK_BUTTONS_NONE,
            "%s",
            m_message.c_str()
        );

        if (!m_title.empty()) {
            gtk_window_set_title(GTK_WINDOW(dialog), m_title.c_str());
        }

        if (!m_detail.empty()) {
            gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dialog), "%s", m_detail.c_str());
        }

        if (m_buttons.empty()) {
            gtk_dialog_add_button(GTK_DIALOG(dialog), "OK", 0);
        } else {
            for (size_t i = 0; i < m_buttons.size(); ++i) {
                gtk_dialog_add_button(GTK_DIALOG(dialog), m_buttons[i].c_str(), (gint)i);
            }
        }

        GtkWidget* check = nullptr;
        if (!m_checkboxLabel.empty()) {
            check = gtk_check_button_new_with_label(m_checkboxLabel.c_str());
            gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(check), m_checkboxChecked ? TRUE : FALSE);
            GtkWidget* content_area = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
            gtk_container_add(GTK_CONTAINER(content_area), check);
            gtk_widget_show(check);
        }

        if (m_testTimeout > 0) {
            g_timeout_add(m_testTimeout, OnGtkTestTimeout, dialog);
        }

        gint res = gtk_dialog_run(GTK_DIALOG(dialog));
        if (res >= 0) {
            m_response = res;
        } else {
            m_response = m_defaultId;
        }

        if (check) {
            m_checkboxChecked = (gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(check)) == TRUE);
        }

        gtk_widget_destroy(dialog);
        while (gtk_events_pending()) gtk_main_iteration();
#endif
    }

    void OnOK() override {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);

        Napi::Object result = Napi::Object::New(env);
        result.Set("response", Napi::Number::New(env, m_response));
        result.Set("checkboxChecked", Napi::Boolean::New(env, m_checkboxChecked));

        m_deferred.Resolve(result);
    }

    void OnError(const Napi::Error& error) override {
        m_deferred.Reject(error.Value());
    }

private:
    Napi::Promise::Deferred m_deferred;
    std::string m_type;
    std::vector<std::string> m_buttons;
    int m_defaultId{0};
    std::string m_title;
    std::string m_message;
    std::string m_detail;
    std::string m_checkboxLabel;
    bool m_checkboxChecked{false};
    int m_testTimeout{0};

    int m_response{0};
};

Napi::Value ShowOpenDialog(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    std::string title = "";
    std::string defaultPath = "";
    std::string buttonLabel = "";
    std::vector<FileFilter> filters;
    std::vector<std::string> properties;
    int testTimeout = 0;

    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();
        testTimeout = CheckTestTimeout(opts);

        if (opts.Has("title") && opts.Get("title").IsString()) {
            title = opts.Get("title").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("defaultPath") && opts.Get("defaultPath").IsString()) {
            defaultPath = opts.Get("defaultPath").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("buttonLabel") && opts.Get("buttonLabel").IsString()) {
            buttonLabel = opts.Get("buttonLabel").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("filters")) {
            filters = ParseFilters(opts.Get("filters"));
        }
        if (opts.Has("properties") && opts.Get("properties").IsArray()) {
            Napi::Array propsArr = opts.Get("properties").As<Napi::Array>();
            for (uint32_t i = 0; i < propsArr.Length(); ++i) {
                Napi::Value propVal = propsArr.Get(i);
                if (propVal.IsString()) {
                    properties.push_back(propVal.As<Napi::String>().Utf8Value());
                }
            }
        }
    }

    auto* worker = new OpenDialogWorker(env, deferred, title, defaultPath, buttonLabel, filters, properties, testTimeout);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value ShowSaveDialog(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    std::string title = "";
    std::string defaultPath = "";
    std::string buttonLabel = "";
    std::vector<FileFilter> filters;
    int testTimeout = 0;

    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();
        testTimeout = CheckTestTimeout(opts);

        if (opts.Has("title") && opts.Get("title").IsString()) {
            title = opts.Get("title").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("defaultPath") && opts.Get("defaultPath").IsString()) {
            defaultPath = opts.Get("defaultPath").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("buttonLabel") && opts.Get("buttonLabel").IsString()) {
            buttonLabel = opts.Get("buttonLabel").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("filters")) {
            filters = ParseFilters(opts.Get("filters"));
        }
    }

    auto* worker = new SaveDialogWorker(env, deferred, title, defaultPath, buttonLabel, filters, testTimeout);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value ShowMessageBox(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    std::string type = "info";
    std::vector<std::string> buttons;
    int defaultId = 0;
    std::string title = "";
    std::string message = "";
    std::string detail = "";
    std::string checkboxLabel = "";
    bool checkboxChecked = false;
    int testTimeout = 0;

    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();
        testTimeout = CheckTestTimeout(opts);

        if (opts.Has("type") && opts.Get("type").IsString()) {
            type = opts.Get("type").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("buttons") && opts.Get("buttons").IsArray()) {
            Napi::Array btns = opts.Get("buttons").As<Napi::Array>();
            for (uint32_t i = 0; i < btns.Length(); ++i) {
                Napi::Value btnVal = btns.Get(i);
                if (btnVal.IsString()) {
                    buttons.push_back(btnVal.As<Napi::String>().Utf8Value());
                }
            }
        }
        if (opts.Has("defaultId") && opts.Get("defaultId").IsNumber()) {
            defaultId = opts.Get("defaultId").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("title") && opts.Get("title").IsString()) {
            title = opts.Get("title").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("message") && opts.Get("message").IsString()) {
            message = opts.Get("message").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("detail") && opts.Get("detail").IsString()) {
            detail = opts.Get("detail").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("checkboxLabel") && opts.Get("checkboxLabel").IsString()) {
            checkboxLabel = opts.Get("checkboxLabel").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("checkboxChecked") && opts.Get("checkboxChecked").IsBoolean()) {
            checkboxChecked = opts.Get("checkboxChecked").As<Napi::Boolean>().Value();
        }
    }

    auto* worker = new MessageBoxWorker(env, deferred, type, buttons, defaultId, title, message, detail, checkboxLabel, checkboxChecked, testTimeout);
    worker->Queue();

    return deferred.Promise();
}

} // namespace Adrenaline
