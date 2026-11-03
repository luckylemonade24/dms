plugins {
    id("com.android.application")
}

// ★ 1. 在顶部定义版本变量
val appVersionName = "0.1.0"

android {
    namespace = "com.ddm.jn1"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.ddm.jn1"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = appVersionName

        ndk {
            abiFilters.add("arm64-v8a")
        }
    }

    // ★ 新增：读取 GitHub 环境变量里的签名信息
    signingConfigs {
        create("release") {
            storeFile = file("release.p12")
            storePassword = System.getenv("KEY_STORE_PASSWORD")
            keyAlias = System.getenv("ALIAS")
            keyPassword = System.getenv("KEY_PASSWORD")
            enableV1Signing = false
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            // ★ 换成 release 签名，不再用 debug
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        variant.outputs.forEach { output ->
            (output as com.android.build.api.variant.impl.VariantOutputImpl).outputFileName.set("DungeonDuelist-${appVersionName}.apk")
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}