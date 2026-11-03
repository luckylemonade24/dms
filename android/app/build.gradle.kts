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
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// ★ AGP 9 终极纯净版：没有 if 判断，直接筛选 release 变体修改名字
androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        variant.outputs.forEach { output ->
            val vName = output.versionName
            (output as com.android.build.api.variant.impl.VariantOutputImpl).outputFileName.set("DungeonDuelist-${vName}.apk")
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}