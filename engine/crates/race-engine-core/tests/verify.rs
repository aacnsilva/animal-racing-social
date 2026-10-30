mod support;

use race_engine_core::{Verification, inputs_from_script, parse_seed, simulate, verify, verify_script_bytes};

#[test]
fn verify_accepts_real_scripts_and_rejects_tampering() {
    let params = support::params();
    let venue = support::venue("v_frost_strip");
    let inputs = support::race_inputs("HORSE", 4, support::varied_field("HORSE", 7, 8));
    let sealed = simulate(&params, &venue, &inputs, &support::seed(42)).expect("simulate");
    assert!(matches!(verify_script_bytes(&params, &venue, &sealed.json), Verification::Ok { .. }));
    let seed = parse_seed(&sealed.script.seed).expect("seed");
    let rebuilt = inputs_from_script(&sealed.script);
    assert_eq!(
        verify(&params, &venue, &rebuilt, &seed, &sealed.script_hash),
        Verification::Ok { script_hash: sealed.script_hash.clone() }
    );
    let text = String::from_utf8(sealed.json.clone()).expect("utf8");
    let winner = &sealed.script.result.order[0];
    let loser = sealed.script.result.order.last().expect("last");
    let swapped = text.replacen(&format!("\"order\":[\"{winner}\""), &format!("\"order\":[\"{loser}\""), 1);
    assert_ne!(swapped, text);
    assert!(matches!(verify_script_bytes(&params, &venue, swapped.as_bytes()), Verification::Mismatch { .. }));
    let mut other_seed = seed;
    other_seed[0] ^= 1;
    assert!(matches!(verify(&params, &venue, &rebuilt, &other_seed, &sealed.script_hash), Verification::Mismatch { .. }));
    let other_params = support::params_with(|value| value["incidents"]["stumblePerKm"] = serde_json::json!(0.004));
    assert!(matches!(verify_script_bytes(&other_params, &venue, &sealed.json), Verification::Mismatch { .. }));
}
