mod support;

use race_engine_core::{PreparedRace, fast_rng, plan_race, simulate, simulate_from};

#[test]
fn varied_fields_produce_several_winners_and_beatable_favourites() {
    let params = support::params();
    let mut favourite_share_sum = 0.0;
    let mut fields = 0.0;
    for (venue_id, species, field_seed) in [
        ("v_meadow_dash", "HORSE", 1u8),
        ("v_riverside_oval", "GIRAFFE", 2),
        ("v_mudflat_ring", "HORSE", 3),
        ("v_coastal_classic", "GIRAFFE", 4),
        ("v_hairpin_hollow", "HORSE", 5),
    ] {
        let venue = support::venue(venue_id);
        let field = support::varied_field(species, 8, field_seed);
        let plan = plan_race(&params, &venue, species, &venue.class, &field).expect("plan");
        let race = PreparedRace::new(&params, &venue, species, plan.laps, &field).expect("race");
        let mut rng = fast_rng([field_seed; 32]);
        let runs = 300;
        let mut wins = vec![0u32; field.len()];
        for _ in 0..runs {
            let outcome = simulate_from(&race, None, &mut rng).expect("outcome");
            wins[outcome.official[0]] += 1;
        }
        let distinct = wins.iter().filter(|count| **count >= 3).count();
        let favourite = support::favourite(species, &field);
        let share = wins[favourite] as f64 / runs as f64;
        assert!(distinct >= 3, "{venue_id}: only {distinct} regular winners {wins:?}");
        assert!(share < 0.6, "{venue_id}: favourite wins {share:.2}");
        favourite_share_sum += share;
        fields += 1.0;
    }
    assert!(favourite_share_sum / fields < 0.5);
}

#[test]
fn incidents_are_rare() {
    let params = support::params();
    let mut clean = 0;
    let mut total = 0;
    for venue_id in ["v_meadow_dash", "v_dune_loop", "v_glacier_grand"] {
        let venue = support::venue(venue_id);
        for species in ["HORSE", "GIRAFFE"] {
            let field = support::varied_field(species, 8, 9);
            let plan = plan_race(&params, &venue, species, &venue.class, &field).expect("plan");
            let inputs = support::race_inputs(species, plan.laps, field);
            for value in 0..25 {
                let sealed = simulate(&params, &venue, &inputs, &support::seed(1000 + value)).expect("simulate");
                total += 1;
                if sealed.script.result.incidents.is_empty() {
                    clean += 1;
                }
            }
        }
    }
    assert!(clean * 2 > total, "only {clean}/{total} races without incidents");
}
