use ars_infra::db::Db;
use ars_infra::{Context, Res, log};
use race_engine_core::{ENGINE_VERSION, LoadedParams, core_version, default_params};

pub async fn register_engine_version(db: &Db) -> Res<()> {
    let params = default_params().map_err(|err| format!("embedded params invalid: {err}"))?;
    if params.version() != ENGINE_VERSION {
        return Err(format!("embedded params version {} != engine {}", params.version(), ENGINE_VERSION));
    }
    let hash = hex::decode(&params.hash).context("params hash")?;
    let value = params.value();
    let conn = db.acquire().await?;
    let insert = "INSERT INTO racing.engine_versions (engine_version, params, params_hash, is_active, replayable)
                  SELECT $1, $2::jsonb, $3, NOT EXISTS (SELECT 1 FROM racing.engine_versions WHERE is_active) AND $4, true
                  ON CONFLICT (engine_version) DO NOTHING";
    let inserted = match conn.execute(insert, &[&ENGINE_VERSION, &value, &hash, &true]).await {
        Ok(count) => count,
        Err(_) => conn.execute(insert, &[&ENGINE_VERSION, &value, &hash, &false]).await.context("register engine version")?,
    };
    if inserted > 0 {
        log::info(format!("registered engine version {ENGINE_VERSION} paramsHash {}", params.hash));
    }
    let rows = conn
        .query("SELECT engine_version, params, params_hash, replayable FROM racing.engine_versions", &[])
        .await
        .context("list engine versions")?;
    for row in rows {
        let version: String = row.get(0);
        let stored: serde_json::Value = row.get(1);
        let stored_hash: Vec<u8> = row.get(2);
        let replayable_now: bool = row.get(3);
        let loaded = LoadedParams::from_value(&stored);
        if version == ENGINE_VERSION {
            if let Ok(loaded) = &loaded
                && loaded.hash != params.hash {
                    log::warn(format!(
                        "engine version {version} in the database has params {} but the binary embeds {}; the database copy is used",
                        loaded.hash, params.hash
                    ));
                }
            if hex::encode(&stored_hash) != params.hash && inserted > 0 {
                log::warn(format!("engine version {version} stored params_hash differs from canonical hash"));
            }
        }
        let replayable = core_version(&version) == ENGINE_VERSION && loaded.is_ok();
        if replayable != replayable_now {
            conn.execute("UPDATE racing.engine_versions SET replayable = $2 WHERE engine_version = $1", &[&version, &replayable])
                .await
                .context("update replayable")?;
            log::info(format!("engine version {version} replayable={replayable}"));
        }
    }
    Ok(())
}

pub async fn supported_versions(db: &Db) -> Res<Vec<(String, String)>> {
    let conn = db.acquire().await?;
    let rows = conn
        .query("SELECT engine_version, params FROM racing.engine_versions ORDER BY created_at, engine_version", &[])
        .await
        .context("list engine versions")?;
    let mut versions = Vec::new();
    for row in rows {
        let version: String = row.get(0);
        if core_version(&version) != ENGINE_VERSION {
            continue;
        }
        let value: serde_json::Value = row.get(1);
        if let Ok(loaded) = LoadedParams::from_value(&value) {
            versions.push((version, loaded.hash));
        }
    }
    Ok(versions)
}
