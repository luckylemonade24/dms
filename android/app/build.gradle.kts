plugins {
    id("com.android.application")
}

android {
    namespace = "com.ddm.jn1"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.ddm.jn1"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            abiFilters.add("arm64-v8a")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("debug")
            // ★ 必须加这一行，你的 proguard-rules.pro 才会生效
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}