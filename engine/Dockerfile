ARG RUST_IMAGE=rust:1.97-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim

FROM ${RUST_IMAGE} AS build
WORKDIR /src
COPY proto proto
COPY shared shared
COPY engine engine
WORKDIR /src/engine
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/engine/target \
    cargo build --release --locked -p race-engine -p race-broadcaster -p odds-engine \
 && mkdir -p /out \
 && cp target/release/race-engine target/release/race-broadcaster target/release/odds-engine /out/

FROM ${RUNTIME_IMAGE}
RUN groupadd --system ars && useradd --system --gid ars --no-create-home ars
COPY --from=build /out/race-engine /out/race-broadcaster /out/odds-engine /usr/local/bin/
COPY shared/venues.json shared/engine-params.json /usr/local/share/ars/
USER ars
ENV RUST_BACKTRACE=1
EXPOSE 7001 7002 7003
CMD ["race-engine"]
