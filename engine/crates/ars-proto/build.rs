use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let proto_root = manifest.join("../../../proto");
    let proto_file = proto_root.join("ars/v1/events.proto");
    println!("cargo:rerun-if-changed={}", proto_file.display());
    println!("cargo:rerun-if-env-changed=PROTOC");
    let mut config = prost_build::Config::new();
    if std::env::var_os("PROTOC").is_none() {
        let on_path = std::process::Command::new("protoc").arg("--version").output().is_ok();
        if !on_path {
            let vendored = protoc_bin_vendored::protoc_bin_path().expect("vendored protoc");
            config.protoc_executable(vendored);
        }
    }
    config.btree_map(["."]);
    config
        .compile_protos(&[proto_file], &[proto_root])
        .expect("compile ars/v1/events.proto");
}
