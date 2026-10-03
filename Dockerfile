# Cross-compiles on the build machine's own arch (no QEMU), then ships just the binary.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod *.go ./
COPY client ./client
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/in-person-queue . \
 && mkdir /out/data

FROM scratch
COPY --from=build /out/in-person-queue /in-person-queue
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532:65532
ENV PORT=8080 STATE_FILE=/data/state.json
VOLUME /data
EXPOSE 8080
HEALTHCHECK CMD ["/in-person-queue", "-healthcheck"]
ENTRYPOINT ["/in-person-queue"]
