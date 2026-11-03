package com.ddm.jn1;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        try {
            webView = new WebView(this);
            webView.setBackgroundColor(android.graphics.Color.BLACK);
            setContentView(webView);

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

            // 1. 导出接口
            webView.addJavascriptInterface(new Object() {
                @android.webkit.JavascriptInterface
                public void saveFile(String fileName, String base64Data) {
                    try {
                        byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            ContentValues contentValues = new ContentValues();
                            contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                            contentValues.put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
                            contentValues.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues);
                            if (uri != null) {
                                OutputStream os = getContentResolver().openOutputStream(uri);
                                if (os != null) {
                                    os.write(bytes);
                                    os.close();
                                }
                                runOnUiThread(() -> Toast.makeText(getApplicationContext(), "存档已存至手机 Download 文件夹: " + fileName, Toast.LENGTH_LONG).show());
                            }
                        } else {
                            File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                            File file = new File(downloadDir, fileName);
                            FileOutputStream fos = new FileOutputStream(file);
                            fos.write(bytes);
                            fos.close();
                            runOnUiThread(() -> Toast.makeText(getApplicationContext(), "存档已存至手机 Download 文件夹: " + fileName, Toast.LENGTH_LONG).show());
                        }
                    } catch (Exception e) {
                        runOnUiThread(() -> Toast.makeText(getApplicationContext(), "保存失败: " + e.getMessage(), Toast.LENGTH_SHORT).show());
                    }
                }
            }, "AndroidSaver");

            // 2. 屏幕旋转接口
            webView.addJavascriptInterface(new Object() {
                @android.webkit.JavascriptInterface
                public void setLandscape() {
                    runOnUiThread(() -> setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE));
                }
                @android.webkit.JavascriptInterface
                public void setPortrait() {
                    runOnUiThread(() -> setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
                }
            }, "AndroidScreen");

            final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                    .build();

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri url = request.getUrl();
                    if (url == null) return null;
                    String urlStr = url.toString();
                    if (urlStr.startsWith("https://appassets.androidplatform.net/") && !urlStr.contains("/assets/")) {
                        String newUrlStr = urlStr.replace(
                                "https://appassets.androidplatform.net/",
                                "https://appassets.androidplatform.net/assets/www/"
                        );
                        return assetLoader.shouldInterceptRequest(Uri.parse(newUrlStr));
                    }
                    return assetLoader.shouldInterceptRequest(url);
                }

                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                    handler.proceed();
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    
                    // 3. 注入 JS：拦截全屏 API，防止 WebView 黑屏
                    String js = "(function() {" +
                            // 拦截 Blob 导出
                            "  const originalClick = HTMLAnchorElement.prototype.click;" +
                            "  HTMLAnchorElement.prototype.click = function() {" +
                            "    if (this.download && this.href && this.href.startsWith('blob:')) {" +
                            "      const fileName = this.download;" +
                            "      fetch(this.href).then(res => res.blob()).then(blob => {" +
                            "          const reader = new FileReader();" +
                            "          reader.onload = () => {" +
                            "            const base64 = reader.result.split(',')[1];" +
                            "            if (window.AndroidSaver) window.AndroidSaver.saveFile(fileName, base64);" +
                            "          };" +
                            "          reader.readAsDataURL(blob);" +
                            "      });" +
                            "      return;" +
                            "    }" +
                            "    return originalClick.apply(this, arguments);" +
                            "  };" +
                            
                            // ★ 核心修复：劫持 requestFullscreen 避免原生全屏黑屏
                            "  var isFakeFullscreen = false;" +
                            "  Object.defineProperty(document, 'fullscreenElement', {" +
                            "    get: function() { return isFakeFullscreen ? document.documentElement : null; }," +
                            "    configurable: true" +
                            "  });" +
                            "  Object.defineProperty(document, 'webkitFullscreenElement', {" +
                            "    get: function() { return isFakeFullscreen ? document.documentElement : null; }," +
                            "    configurable: true" +
                            "  });" +
                            "  Element.prototype.requestFullscreen = function() {" +
                            "    isFakeFullscreen = true;" +
                            "    if (window.AndroidScreen) window.AndroidScreen.setLandscape();" +
                            "    document.dispatchEvent(new Event('fullscreenchange'));" +
                            "    document.dispatchEvent(new Event('webkitfullscreenchange'));" +
                            "    return Promise.resolve();" +
                            "  };" +
                            "  Element.prototype.webkitRequestFullscreen = Element.prototype.requestFullscreen;" +
                            "  document.exitFullscreen = function() {" +
                            "    isFakeFullscreen = false;" +
                            "    if (window.AndroidScreen) window.AndroidScreen.setPortrait();" +
                            "    document.dispatchEvent(new Event('fullscreenchange'));" +
                            "    document.dispatchEvent(new Event('webkitfullscreenchange'));" +
                            "    return Promise.resolve();" +
                            "  };" +
                            "  document.webkitExitFullscreen = document.exitFullscreen;" +
                            "})();";
                    view.evaluateJavascript(js, null);
                }
            });

            // 4. 原生全屏（视频等，防报错保留）
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> newFilePathCallback, FileChooserParams fileChooserParams) {
                    if (filePathCallback != null) {
                        filePathCallback.onReceiveValue(null);
                    }
                    filePathCallback = newFilePathCallback;
                    try {
                        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType("*/*");
                        startActivityForResult(Intent.createChooser(intent, "选择存档"), 100);
                    } catch (Exception e) {
                        filePathCallback = null;
                        return false;
                    }
                    return true;
                }

                @Override
                public void onShowCustomView(View view, CustomViewCallback callback) {
                    super.onShowCustomView(view, callback);
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                }

                @Override
                public void onHideCustomView() {
                    super.onHideCustomView();
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                }
            });

            // 5. 兜底下载
            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setMimeType(mimetype);
                    request.addRequestHeader("User-Agent", userAgent);
                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimetype);
                    request.setTitle(fileName);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(request);
                    runOnUiThread(() -> Toast.makeText(getApplicationContext(), "开始下载...", Toast.LENGTH_SHORT).show());
                } catch (Exception ignored) {}
            });

            webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");

        } catch (Exception e) {
            e.printStackTrace();
            TextView tv = new TextView(this);
            tv.setText("应用启动崩溃！\n原因: " + e.getMessage());
            tv.setTextColor(android.graphics.Color.RED);
            tv.setTextSize(20f);
            tv.setPadding(50, 100, 50, 50);
            setContentView(tv);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == 100) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}