mod support;

use race_engine_core::plan_race;

#[test]
fn every_venue_and_species_plans_inside_its_class_window() {
    let params = support::params();
    for venue in support::venues() {
        for species in ["HORSE", "GIRAFFE"] {
            let field = support::typical_field(species, 8);
            let plan = plan_race(&params, &venue, species, &venue.class, &field).expect("plan");
            let window = params.params.classes[&venue.class];
            assert!(plan.laps >= venue.laps_range[0] && plan.laps <= venue.laps_range[1]);
            assert!(
                plan.median_duration_sec >= window.min_sec && plan.median_duration_sec <= window.max_sec,
                "{} {} laps {} median {:.0}s outside {}-{}",
                venue.id,
                species,
                plan.laps,
                plan.median_duration_sec,
                window.min_sec,
                window.max_sec
            );
            assert!(plan.in_window);
        }
    }
}

#[test]
fn planning_is_deterministic() {
    let params = support::params();
    let venue = support::venue("v_summit_circuit");
    let field = support::typical_field("HORSE", 8);
    let first = plan_race(&params, &venue, "HORSE", "ENDURANCE", &field).expect("plan");
    let second = plan_race(&params, &venue, "HORSE", "ENDURANCE", &field).expect("plan");
    assert_eq!(first, second);
}
