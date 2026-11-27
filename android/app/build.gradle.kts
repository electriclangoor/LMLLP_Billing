import java.util.Properties

plugins {
    id("com.android.application")
}

// The signing key lives in android/keystore/ (never committed). Back that folder up:
// every update must be signed with the same key or Android refuses to install it.
val keyProps = Properties().apply {
    val f = rootProject.file("keystore/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.langoormedia.biller"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.langoormedia.biller"
        minSdk = 33
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            if (keyProps.isNotEmpty()) {
                storeFile = rootProject.file("keystore/" + keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
}
