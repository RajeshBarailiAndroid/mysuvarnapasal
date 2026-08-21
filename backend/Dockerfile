# Multi-stage build shared by all four services; pick the module with
#   --build-arg MODULE=auth-service|store-service|rates-service|api-gateway
FROM gradle:8.14-jdk21 AS build
ARG MODULE
WORKDIR /src
COPY settings.gradle.kts build.gradle.kts gradle.properties ./
COPY common ./common
COPY auth-service ./auth-service
COPY store-service ./store-service
COPY rates-service ./rates-service
COPY api-gateway ./api-gateway
RUN gradle :${MODULE}:bootJar --no-daemon

FROM eclipse-temurin:21-jre-alpine
ARG MODULE
COPY --from=build /src/${MODULE}/build/libs/*.jar /app.jar
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app.jar"]
