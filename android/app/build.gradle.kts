plugins {
    id("com.android.application")
}

android {
    namespace = "com.ddm.jn"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.ddm.jn"
        minSdk = 24
        targetSdk = 34 // 降级到当前最稳定的 34，防闪退
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            abiFilters.add("arm64-v8a")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // 删掉了 appcompat，只用 webkit
    implementation("androidx.webkit:webkit:1.12.1")
}