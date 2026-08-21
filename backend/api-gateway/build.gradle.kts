plugins {
    kotlin("jvm")
    kotlin("plugin.spring")
    id("org.springframework.boot")
    id("io.spring.dependency-management")
}

extra["springCloudVersion"] = "2023.0.5"

dependencies {
    implementation("org.springframework.cloud:spring-cloud-starter-gateway")
}

dependencyManagement {
    imports {
        mavenBom("org.springframework.cloud:spring-cloud-dependencies:${property("springCloudVersion")}")
    }
    // Spring Cloud Gateway 4.1.6 calls HttpHeaders.headerSet(), which only exists in
    // Spring Framework 6.2 (Spring Boot 3.4+). This project runs Boot 3.3.5, which ships
    // Framework 6.1.x, so 4.1.6 dies with NoSuchMethodError on every proxied request.
    //
    // These entries take precedence over the imported BOM. (Gradle's resolutionStrategy
    // .force does NOT work here — the dependency-management plugin re-applies the BOM's
    // managed version afterwards and wins.)
    dependencies {
        dependency("org.springframework.cloud:spring-cloud-starter-gateway:4.1.5")
        dependency("org.springframework.cloud:spring-cloud-gateway-server:4.1.5")
    }
}
