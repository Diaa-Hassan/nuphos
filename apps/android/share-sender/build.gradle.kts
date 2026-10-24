plugins { alias(libs.plugins.android.application) }
android {
    namespace = "ai.nuphos.sharefixture"
    compileSdk = 37
    defaultConfig {
        applicationId = "ai.nuphos.shareinput1355.sender"
        minSdk = 33
        targetSdk = 36
        versionCode = 1
        versionName = "synthetic-1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
