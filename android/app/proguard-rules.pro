# 只保留给 JS 调用的接口方法，防止被混淆/删除
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}