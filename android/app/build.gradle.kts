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

// ★ 纯正 AGP 9 重命名：不写默认值，只拼游戏名和真实版本号
androidComponents {
    onVariants { variant ->
        if (variant.buildType == "release") {
            val vName = variant.versionName.get()
            
            variant.outputs.forEach { output ->
                if (output is com.android.build.api.variant.impl.VariantOutputImpl) {
                    output.outputFileName.set("DungeonDuelist-${vName}.apk")
                }
            }
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}