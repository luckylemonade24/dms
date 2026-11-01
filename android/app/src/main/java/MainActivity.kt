package com.ddm.jn

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.*
import androidx.webkit.WebViewAssetLoader
import java.io.File

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        try {
            webView = WebView(this)
            webView.setBackgroundColor(android.graphics.Color.BLACK)
            setContentView(webView)

            webView.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                useWideViewPort = true
                loadWithOverviewMode = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = true
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }

            // ==========================================
            // 核心 1：原生保存接口，用于保存前端导出的存档
            // ==========================================
            webView.addJavascriptInterface(object {
                @JavascriptInterface
                fun saveFile(fileName: String, base64Data: String) {
                    try {
                        val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            // Android 10+ 无需权限，直接写入公共 Download 文件夹
                            val resolver = contentResolver
                            val contentValues = ContentValues().apply {
                                put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                                put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream")
                                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                            }
                            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                            if (uri != null) {
                                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                                runOnUiThread { android.widget.Toast.makeText(applicationContext, "存档已存至手机 Download 文件夹: $fileName", android.widget.Toast.LENGTH_LONG).show() }
                            }
                        } else {
                            // Android 9 及以下直接写公共目录
                            val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                            val file = File(downloadDir, fileName)
                            file.writeBytes(bytes)
                            runOnUiThread { android.widget.Toast.makeText(applicationContext, "存档已存至手机 Download 文件夹: $fileName", android.widget.Toast.LENGTH_LONG).show() }
                        }
                    } catch (e: Exception) {
                        runOnUiThread { android.widget.Toast.makeText(applicationContext, "保存失败: ${e.message}", android.widget.Toast.LENGTH_SHORT).show() }
                    }
                }
            }, "AndroidSaver")

            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
                .build()

            webView.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                    val url = request?.url ?: return null
                    val urlStr = url.toString()
                    if (urlStr.startsWith("https://appassets.androidplatform.net/") && !urlStr.contains("/assets/")) {
                        val newUrl = urlStr.replace(
                            "https://appassets.androidplatform.net/",
                            "https://appassets.androidplatform.net/assets/www/"
                        )
                        return assetLoader.shouldInterceptRequest(Uri.parse(newUrl))
                    }
                    return assetLoader.shouldInterceptRequest(url)
                }

                override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                    handler?.proceed()
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // 注入 JS：拦截所有 Blob 导出，扔给原生保存
                    val js = """
                        (function() {
                            const originalClick = HTMLAnchorElement.prototype.click;
                            HTMLAnchorElement.prototype.click = function() {
                                if (this.download && this.href && this.href.startsWith('blob:')) {
                                    const fileName = this.download;
                                    fetch(this.href)
                                        .then(res => res.blob())
                                        .then(blob => {
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                                const base64 = reader.result.split(',')[1];
                                                if (window.AndroidSaver) {
                                                    window.AndroidSaver.saveFile(fileName, base64);
                                                }
                                            };
                                            reader.readAsDataURL(blob);
                                        });
                                    return; // 阻断原生 WebView 的无效下载
                                }
                                return originalClick.apply(this, arguments);
                            };
                        })();
                    """.trimIndent()
                    view?.evaluateJavascript(js, null)
                }
            }

            // ==========================================
            // 核心 2：导入存档
            // ==========================================
            webView.webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    newFilePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = newFilePathCallback
                    try {
                        val intent = Intent(Intent.ACTION_GET_CONTENT)
                        intent.addCategory(Intent.CATEGORY_OPENABLE)
                        intent.type = "*/*"
                        startActivityForResult(Intent.createChooser(intent, "选择存档"), 100)
                    } catch (e: Exception) {
                        filePathCallback = null
                        return false
                    }
                    return true
                }
            }

            // 兜底：如果是普通的 URL 下载
            webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
                try {
                    val request = DownloadManager.Request(Uri.parse(url))
                    request.setMimeType(mimetype)
                    request.addRequestHeader("User-Agent", userAgent)
                    val fileName = URLUtil.guessFileName(url, contentDisposition, mimetype)
                    request.setTitle(fileName)
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                    val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                    dm.enqueue(request)
                    runOnUiThread { android.widget.Toast.makeText(applicationContext, "开始下载...", android.widget.Toast.LENGTH_SHORT).show() }
                } catch (e: Exception) {}
            }

            webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        } catch (e: Exception) {
            e.printStackTrace()
            val tv = android.widget.TextView(this)
            tv.text = "应用启动崩溃！\n原因: ${e.message}"
            tv.setTextColor(android.graphics.Color.RED)
            tv.textSize = 20f
            tv.setPadding(50, 100, 50, 50)
            setContentView(tv)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == 100) {
            if (filePathCallback == null) return
            val results: Array<Uri>? = if (resultCode == Activity.RESULT_OK) {
                val uri = data?.data
                if (uri != null) arrayOf(uri) else null
            } else null
            filePathCallback?.onReceiveValue(results)
            filePathCallback = null
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}