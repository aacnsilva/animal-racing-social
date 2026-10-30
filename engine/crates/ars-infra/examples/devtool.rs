use std::time::{Duration, SystemTime};

use ars_infra::kafka::{MARKET_EVENTS, Producer, RACE_COMMANDS, RACE_LIFECYCLE, RACE_TICKS};
use ars_infra::{Context, Res, config};
use ars_proto::envelope::Payload;
use ars_proto::{EntrantInfo, GenerateScript, MarketOpened, RaceOpened, RaceScheduled, SelectionPrice, Stats};
use rdkafka::Message;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn http_post(url: &str, body: &serde_json::Value) -> Res<serde_json::Value> {
    let rest = url.strip_prefix("http://").context("url must start with http://")?;
    let (host_port, path) = rest.split_once('/').map(|(host, path)| (host, format!("/{path}"))).unwrap_or((rest, "/".into()));
    let mut stream = tokio::net::TcpStream::connect(host_port).await.context("connect")?;
    let payload = body.to_string();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {host_port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream.write_all(request.as_bytes()).await.context("write")?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.context("read")?;
    let text = String::from_utf8_lossy(&response).to_string();
    let (head, body) = text.split_once("\r\n\r\n").context("bad http response")?;
    if !head.starts_with("HTTP/1.1 200") {
        return Err(format!("{head}\n{body}"));
    }
    serde_json::from_str(body).context("response json")
}

async fn schedule(args: &[String]) -> Res<()> {
    let race_id: i64 = args.first().context("race_id")?.parse().context("race_id")?;
    let venue_id = args.get(1).context("venue_id")?.clone();
    let species = args.get(2).context("species")?.clone();
    let start_in: u64 = args.get(3).context("start_in_secs")?.parse().context("start_in")?;
    let field: i64 = args.get(4).map(|value| value.parse().unwrap_or(8)).unwrap_or(8);
    let engine_url = config::string("RACE_ENGINE_URL", "http://localhost:7001");
    let odds_url = config::string("ODDS_ENGINE_URL", "http://localhost:7003");
    let client = ars_infra::db::connect(&config::database_url()).await?;
    let venue_row = client
        .query_one("SELECT race_class, version FROM racing.venues WHERE venue_id = $1 ORDER BY version DESC LIMIT 1", &[&venue_id])
        .await
        .context("venue")?;
    let race_class: String = venue_row.get(0);
    let venue_version: i32 = venue_row.get(1);
    let animals = client
        .query(
            "SELECT animal_id, temperament, cur_velocity::float8, cur_stamina::float8, cur_acceleration::float8, cur_consistency::float8, name
               FROM stable.animals WHERE species = $1 ORDER BY random() LIMIT $2",
            &[&species, &field],
        )
        .await
        .context("animals")?;
    let mut lanes: Vec<u32> = (1..=10).collect();
    let mut seed = ars_infra::ids::random_bytes::<16>();
    for index in (1..lanes.len()).rev() {
        let pick = seed[index] as usize % (index + 1);
        lanes.swap(index, pick);
        seed[index] = 0;
    }
    let entrants: Vec<EntrantInfo> = animals
        .iter()
        .enumerate()
        .map(|(index, row)| EntrantInfo {
            entrant_id: format!("e{}", index + 1),
            animal_id: row.get(0),
            lane: lanes[index],
            temperament: row.get(1),
            stats: Some(Stats { velocity: row.get(2), stamina: row.get(3), acceleration: row.get(4), consistency: row.get(5) }),
            name: row.get(6),
        })
        .collect();
    let wire_entrants: Vec<serde_json::Value> = entrants
        .iter()
        .map(|entrant| {
            let stats = entrant.stats.unwrap_or_default();
            serde_json::json!({
                "entrantId": entrant.entrant_id, "animalId": entrant.animal_id.to_string(), "lane": entrant.lane,
                "temperament": entrant.temperament,
                "stats": { "velocity": stats.velocity, "stamina": stats.stamina, "acceleration": stats.acceleration, "consistency": stats.consistency }
            })
        })
        .collect();
    let plan = http_post(
        &format!("{engine_url}/internal/plan"),
        &serde_json::json!({ "venueId": venue_id, "venueVersion": venue_version, "species": species, "raceClass": race_class,
                             "engineVersion": "1.0.0", "entrants": wire_entrants }),
    )
    .await?;
    println!("plan: {plan}");
    let laps = plan["laps"].as_i64().context("laps")? as i32;
    let estimate = plan["estimatedDurationSec"].as_i64().context("estimate")? as i32;
    let start_at = SystemTime::now() + Duration::from_secs(start_in);
    let closes_at = start_at - Duration::from_secs(60);
    client
        .execute(
            "INSERT INTO racing.races (race_id, season_id, species, race_class, venue_id, venue_version, engine_version, laps,
                                       estimated_duration_s, status, start_at, betting_closes_at)
             VALUES ($1, 1, $2, $3, $4, $5, '1.0.0', $6, $7, 'SCHEDULED', $8, $9)",
            &[&race_id, &species, &race_class, &venue_id, &venue_version, &laps, &estimate, &start_at, &closes_at],
        )
        .await
        .context("insert race")?;
    for entrant in &entrants {
        let stats = entrant.stats.unwrap_or_default();
        let snapshot = serde_json::json!({ "velocity": stats.velocity, "stamina": stats.stamina, "acceleration": stats.acceleration, "consistency": stats.consistency });
        let number: i32 = entrant.entrant_id[1..].parse().unwrap_or(0);
        client
            .execute(
                "INSERT INTO racing.race_entrants (race_id, entrant_id, animal_id, lane, temperament, stats_snapshot) VALUES ($1, $2, $3, $4, $5, $6)",
                &[&race_id, &number, &entrant.animal_id, &(entrant.lane as i32), &entrant.temperament, &snapshot],
            )
            .await
            .context("insert entrant")?;
    }
    let producer = Producer::new(&config::kafka_brokers(), "devtool")?;
    let command = GenerateScript {
        race_id,
        engine_version: "1.0.0".into(),
        venue_id: venue_id.clone(),
        venue_version: venue_version as u32,
        laps: laps as u32,
        entrants: entrants.clone(),
        species: species.clone(),
    };
    producer.publish_payload(RACE_COMMANDS, &race_id.to_string(), Payload::GenerateScript(command)).await?;
    println!("GenerateScript published for race {race_id}; waiting for seal");
    let (seed_hash, script_hash) = loop {
        let row = client
            .query_one("SELECT encode(seed_hash, 'hex'), encode(script_hash, 'hex') FROM racing.races WHERE race_id = $1", &[&race_id])
            .await
            .context("poll seal")?;
        if let (Some(seed_hash), Some(script_hash)) = (row.get::<_, Option<String>>(0), row.get::<_, Option<String>>(1)) {
            break (seed_hash, script_hash);
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    };
    println!("sealed seedHash {seed_hash} scriptHash {script_hash}");
    client.execute("UPDATE racing.races SET status = 'OPEN' WHERE race_id = $1", &[&race_id]).await.context("open")?;
    let scheduled = RaceScheduled {
        race_id,
        season_id: 1,
        species: species.clone(),
        race_class: race_class.clone(),
        venue_id: venue_id.clone(),
        venue_version: venue_version as u32,
        engine_version: "1.0.0".into(),
        start_at: ars_infra::time::format_rfc3339(start_at),
        laps: laps as u32,
        estimated_duration_sec: estimate as u32,
        tick_ms: 500,
        entrants: entrants.clone(),
        seed_hash,
        script_hash,
    };
    producer.publish_payload(RACE_LIFECYCLE, &race_id.to_string(), Payload::RaceScheduled(scheduled)).await?;
    producer.publish_payload(RACE_LIFECYCLE, &race_id.to_string(), Payload::RaceOpened(RaceOpened { race_id })).await?;
    let mut market_specs = vec![
        ("FINISH_POSITION", serde_json::json!({ "position": 1 })),
        ("TOP_N", serde_json::json!({ "n": 3 })),
        ("TRICAST", serde_json::json!({})),
    ];
    if laps > 2 {
        market_specs.push(("LEADER_AT_LAP", serde_json::json!({ "lap": 2 })));
    }
    let priced = http_post(
        &format!("{odds_url}/internal/price"),
        &serde_json::json!({ "venueId": venue_id, "venueVersion": venue_version, "species": species, "laps": laps,
                             "engineVersion": "1.0.0", "entrants": wire_entrants,
                             "markets": market_specs.iter().map(|(kind, params)| serde_json::json!({ "type": kind, "params": params })).collect::<Vec<_>>() }),
    )
    .await?;
    println!("pre-race prices (runs {}):", priced["runs"]);
    for (index, (kind, params)) in market_specs.iter().enumerate() {
        let market_id = race_id * 10 + index as i64 + 1;
        let market = &priced["markets"][index];
        println!("  market {market_id} {kind} {params}: {}", market["selections"]);
        client
            .execute(
                "INSERT INTO market.markets (market_id, race_id, type, params, status, template_version, opens_rule, closes_rule, price_version)
                 VALUES ($1, $2, $3, $4, 'OPEN', 1, '{}'::jsonb, '{}'::jsonb, 1)",
                &[&market_id, &race_id, kind, params],
            )
            .await
            .context("insert market")?;
        let mut selections = Vec::new();
        for (position, selection) in market["selections"].as_array().cloned().unwrap_or_default().iter().enumerate() {
            let entrant_id = selection["entrantId"].as_str().unwrap_or_default().to_string();
            let selection_id = market_id * 100 + position as i64 + 1;
            let number: i32 = entrant_id[1..].parse().unwrap_or(0);
            let price = selection["price"].as_f64().unwrap_or(1.01);
            let probability = selection["probability"].as_f64().unwrap_or(0.0);
            client
                .execute(
                    "INSERT INTO market.selections (selection_id, market_id, race_id, entrant_id, price, probability, price_version)
                     VALUES ($1, $2, $3, $4, $5::float8, $6::float8, 1)",
                    &[&selection_id, &market_id, &race_id, &number, &price, &probability],
                )
                .await
                .context("insert selection")?;
            selections.push(SelectionPrice { selection_id, entrant_id, price, probability });
        }
        let params_map = params
            .as_object()
            .map(|object| object.iter().map(|(key, value)| (key.clone(), value.as_i64().unwrap_or(0) as i32)).collect())
            .unwrap_or_default();
        let opened = MarketOpened {
            market_id,
            race_id,
            r#type: kind.to_string(),
            params: params_map,
            selections,
            price_version: 1,
            closes_at_lap: None,
        };
        producer.publish_payload(MARKET_EVENTS, &race_id.to_string(), Payload::MarketOpened(opened)).await?;
    }
    println!("race {race_id} OPEN at {venue_id} ({species} {race_class}, {laps} laps, ~{estimate}s), starts in {start_in}s");
    Ok(())
}

async fn regenerate(args: &[String]) -> Res<()> {
    let race_id: i64 = args.first().context("race_id")?.parse().context("race_id")?;
    let client = ars_infra::db::connect(&config::database_url()).await?;
    let race = client
        .query_one("SELECT engine_version, venue_id, venue_version, laps, species FROM racing.races WHERE race_id = $1", &[&race_id])
        .await
        .context("race")?;
    let rows = client
        .query(&format!("SELECT {} FROM racing.race_entrants WHERE race_id = $1 ORDER BY entrant_id", ars_infra::convert::ENTRANT_COLUMNS), &[&race_id])
        .await
        .context("entrants")?;
    let entrants = rows
        .iter()
        .map(|row| {
            let entrant = ars_infra::convert::entrant_from_row(row)?;
            Ok(EntrantInfo {
                entrant_id: entrant.entrant_id,
                animal_id: entrant.animal_id.parse().unwrap_or(0),
                lane: entrant.lane,
                temperament: entrant.temperament.key().to_string(),
                stats: Some(Stats {
                    velocity: entrant.stats.velocity,
                    stamina: entrant.stats.stamina,
                    acceleration: entrant.stats.acceleration,
                    consistency: entrant.stats.consistency,
                }),
                name: String::new(),
            })
        })
        .collect::<Res<Vec<_>>>()?;
    let command = GenerateScript {
        race_id,
        engine_version: race.get(0),
        venue_id: race.get(1),
        venue_version: race.get::<_, i32>(2) as u32,
        laps: race.get::<_, i32>(3) as u32,
        entrants,
        species: race.get(4),
    };
    let producer = Producer::new(&config::kafka_brokers(), "devtool")?;
    producer.publish_payload(RACE_COMMANDS, &race_id.to_string(), Payload::GenerateScript(command)).await?;
    println!("GenerateScript re-published for race {race_id}");
    Ok(())
}

fn summary(payload: &Payload) -> String {
    match payload {
        Payload::RaceTick(tick) => {
            let leader = tick.entrants.iter().find(|entrant| entrant.pos == 1).map(|entrant| entrant.id.clone()).unwrap_or_default();
            let events: Vec<String> = tick.events.iter().map(|event| event.r#type.clone()).collect();
            format!("race {} tick {} lap {} leader {} events {:?}", tick.race_id, tick.tick, tick.lap, leader, events)
        }
        Payload::PriceUpdated(update) => {
            let prices: Vec<String> = update.selections.iter().map(|selection| format!("{}@{}", selection.entrant_id, selection.price)).collect();
            format!("market {} tick {} v{} {}", update.market_id, update.tick, update.price_version, prices.join(" "))
        }
        Payload::RaceFinished(finished) => format!(
            "race {} finishTick {} order {:?} asRun {:?} incidents {} lapLeaders {} seed {}",
            finished.race_id,
            finished.finish_tick,
            finished.order,
            finished.as_run,
            finished.incidents.len(),
            finished.lap_leaders.len(),
            finished.seed
        ),
        other => format!("{other:?}"),
    }
}

async fn watch(args: &[String]) -> Res<()> {
    let topics: Vec<&str> = if args.is_empty() {
        vec![RACE_LIFECYCLE, RACE_TICKS, MARKET_EVENTS, RACE_COMMANDS]
    } else {
        args.iter().map(String::as_str).collect()
    };
    let group = format!("devtool-{}", ars_infra::ids::uuid_v4());
    let consumer = ars_infra::kafka::consumer(&config::kafka_brokers(), &group, &topics, "latest")?;
    let every: u32 = config::number("WATCH_TICK_EVERY", 20);
    loop {
        let message = consumer.recv().await.context("recv")?;
        let Some(bytes) = message.payload() else { continue };
        let envelope = ars_infra::envelope::decode(bytes)?;
        let Some(payload) = &envelope.payload else { continue };
        if let Payload::RaceTick(tick) = payload
            && tick.tick % every != 0 && tick.events.iter().all(|event| event.r#type == "OVERTAKE") {
                continue;
            }
        let key = message.key().map(|key| String::from_utf8_lossy(key).to_string()).unwrap_or_default();
        println!("{} {} key={} {} {}", envelope.occurred_at, message.topic(), key, envelope.r#type, summary(payload));
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("schedule") => schedule(&args[1..]).await,
        Some("watch") => watch(&args[1..]).await,
        Some("regenerate") => regenerate(&args[1..]).await,
        _ => Err("usage: devtool schedule <race_id> <venue_id> <species> <start_in_secs> [field] | devtool regenerate <race_id> | devtool watch [topics...]".into()),
    };
    if let Err(err) = result {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
