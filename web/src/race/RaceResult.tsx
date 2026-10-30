import { useEffect, useState } from 'react';
import { ErrorNotice, Lane, Loading, Spinner } from '../components/ui';
import { api, apiBytes, ApiError } from '../lib/api';
import { hexToBytes, sha256Hex } from '../lib/crypto';
import { friendlyCode } from '../lib/errors';
import { fmtDateTime, fmtPrice, fmtRaceTime, marketLabel, ordinal } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { Link } from '../lib/router';
import type { Entrant, RaceResultResponse } from '../lib/types';
import { nameLookup } from './events';

const RESULT_CHIP: Record<string, { label: string; cls: string }> = {
  FINISHED: { label: 'Finished', cls: 'green' },
  DISQUALIFIED: { label: 'DQ', cls: 'red' },
  DNF: { label: 'DNF', cls: 'red' },
  NON_RUNNER: { label: 'NR', cls: 'grey' },
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type VerifyState = { kind: 'running' | 'ok' | 'bad' | 'partial' | 'error'; text: string; details: string[] };

function VerifyCommitment({ raceId, seed, seedHash, scriptHash }: { raceId: string; seed: string | null; seedHash: string | null; scriptHash: string | null }) {
  const [state, setState] = useState<VerifyState | null>(null);
  const run = async () => {
    setState({ kind: 'running', text: 'Checking…', details: [] });
    const details: string[] = [];
    let seedOk: boolean | null = null;
    let scriptOk: boolean | null = null;
    let via = 'webcrypto';
    try {
      if (seed && seedHash) {
        const digest = await sha256Hex(hexToBytes(seed));
        via = digest.via;
        seedOk = digest.hex === seedHash.toLowerCase();
        details.push(`SHA-256(seed bytes) = ${digest.hex}`);
      } else details.push('Seed not revealed yet.');
      if (scriptHash) {
        try {
          const bytes = new Uint8Array(await apiBytes(`/v1/races/${raceId}/script`));
          const digest = await sha256Hex(bytes);
          scriptOk = digest.hex === scriptHash.toLowerCase();
          details.push(`SHA-256(script, ${bytes.length.toLocaleString()} bytes) = ${digest.hex}`);
        } catch (error) {
          details.push(`Script unavailable: ${error instanceof ApiError ? `${friendlyCode(error.code)} (${error.code})` : 'download failed'}`);
        }
      }
      details.push(`Hashed with ${via === 'webcrypto' ? 'WebCrypto' : 'built-in SHA-256 (WebCrypto needs HTTPS)'}`);
      if (seedOk === false || scriptOk === false) {
        setState({ kind: 'bad', text: `FAILED · ${seedOk === false ? 'seed' : 'script'} hash differs from the published commitment`, details });
      } else if (seedOk && scriptOk) {
        setState({ kind: 'ok', text: 'VERIFIED · seed and script hashes match the commitments published before betting opened', details });
      } else if (seedOk) {
        setState({ kind: 'partial', text: 'Seed VERIFIED · the script could not be checked', details });
      } else {
        setState({ kind: 'partial', text: 'Nothing to check yet', details });
      }
    } catch (error) {
      setState({ kind: 'error', text: `Could not verify: ${(error as Error).message}`, details });
    }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap">
        <button className="btn" data-testid="verify-commitment" onClick={() => void run()} disabled={state?.kind === 'running'}>
          {state?.kind === 'running' ? <Spinner /> : '🔒'} Verify commitment
        </button>
      </div>
      {state && (
        <div className={`notice ${state.kind === 'ok' ? 'success' : state.kind === 'bad' || state.kind === 'error' ? 'error' : 'info'}`}>
          <div data-testid="verify-status" className={state.kind === 'ok' ? 'verify-ok' : state.kind === 'bad' ? 'verify-bad' : ''}>
            {state.text}
          </div>
          {state.details.map((line) => (
            <div key={line} className="mono tiny" style={{ overflowWrap: 'anywhere', marginTop: 4 }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RaceResult({
  raceId,
  version,
  entrants,
  onWatchReplay,
  replayLoading,
}: {
  raceId: string;
  version: number;
  entrants: Entrant[];
  onWatchReplay: () => void;
  replayLoading: boolean;
}) {
  const debouncedVersion = useDebounced(version, 700);
  const { data, error, loading, reload } = useAsync(() => api<RaceResultResponse>(`/v1/races/${raceId}/result`), [raceId, debouncedVersion]);
  const [result, setResult] = useState<RaceResultResponse | null>(null);
  useEffect(() => {
    if (data) setResult(data);
  }, [data]);

  if (!result) {
    if (error) {
      if (error instanceof ApiError && error.code === 'RACE_NOT_FINISHED') return null;
      return (
        <section className="card" data-testid="race-result">
          <ErrorNotice error={error} onRetry={reload} />
        </section>
      );
    }
    return loading ? (
      <section className="card" data-testid="race-result">
        <Loading label="Loading result…" />
      </section>
    ) : null;
  }

  const allEntrants = result.race.entrants?.length ? result.race.entrants : entrants;
  const byId = new Map(allEntrants.map((e) => [e.entrantId, e]));
  const name = nameLookup(allEntrants);
  const order = result.order.length ? result.order : [...allEntrants].sort((a, b) => (a.result?.officialPosition ?? 99) - (b.result?.officialPosition ?? 99)).map((e) => e.entrantId);
  const winnerTime = byId.get(order[0] ?? '')?.result?.finishTimeMs ?? null;
  const lapsLed = new Map<string, number>();
  for (const leader of result.lapLeaders) lapsLed.set(leader.entrantId, (lapsLed.get(leader.entrantId) ?? 0) + 1);

  return (
    <section className="card stack" data-testid="race-result" style={{ gap: 18 }}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Official result</h2>
        <span className="small muted">Settles on the official order · lap markets settle as run</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Runner</th>
              <th>Status</th>
              <th className="right">Time</th>
              <th className="right hide-sm">Behind</th>
              <th className="right hide-sm">As run</th>
              <th className="right hide-sm">Laps led</th>
            </tr>
          </thead>
          <tbody>
            {order.map((entrantId, index) => {
              const entrant = byId.get(entrantId);
              const r = entrant?.result;
              const pos = r?.officialPosition ?? index + 1;
              const chip = RESULT_CHIP[r?.resultStatus ?? 'FINISHED']!;
              const counted = r?.resultStatus === 'FINISHED' || r?.resultStatus === 'DISQUALIFIED';
              return (
                <tr key={entrantId} data-testid="result-row" data-entrant-id={entrantId} data-result-status={r?.resultStatus ?? ''}>
                  <td>
                    <span className={`pos-badge${pos <= 3 ? ` p${pos}` : ''}`}>{pos}</span>
                  </td>
                  <td>
                    <span className="row">
                      {entrant && <Lane lane={entrant.lane} small />}
                      {entrant ? <Link to={`/animals/${entrant.animal.id}`}>{entrant.animal.name}</Link> : entrantId}
                    </span>
                  </td>
                  <td>
                    <span className={`chip ${chip.cls}`}>{chip.label}</span>
                  </td>
                  <td className="right num">{counted ? fmtRaceTime(r?.finishTimeMs) : r ? `${Math.round(r.distanceCovered)} m` : '—'}</td>
                  <td className="right num hide-sm">{counted && winnerTime !== null && r?.finishTimeMs && index > 0 ? `+${((r.finishTimeMs - winnerTime) / 1000).toFixed(2)}s` : ''}</td>
                  <td className="right num hide-sm">{r?.asRunPosition && r.asRunPosition !== pos ? ordinal(r.asRunPosition) : ''}</td>
                  <td className="right num hide-sm">{lapsLed.get(entrantId) ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div>
          <h3 style={{ marginBottom: 8 }}>Lap leaders</h3>
          {result.lapLeaders.length === 0 ? (
            <div className="small muted">No lap leaders recorded.</div>
          ) : (
            <div className="pill-list">
              {result.lapLeaders.map((leader) => (
                <span className="chip" key={leader.lap} title={`Tick ${leader.tick}`}>
                  L{leader.lap}: {name(leader.entrantId)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Incidents</h3>
          {result.incidents.length === 0 ? (
            <div className="small muted">A clean race: no incidents.</div>
          ) : (
            <div className="feed" style={{ maxHeight: 180 }}>
              {result.incidents.map((incident) => (
                <div key={incident.seq}>
                  <span className="t">{incident.tick !== null ? `t${incident.tick}` : ''}</span>
                  <span>
                    <b>{incident.type.replace(/_/g, ' ')}</b> {incident.entrantId ? `· ${name(incident.entrantId)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: 8 }}>Market results</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Status</th>
                <th>Winning selection</th>
              </tr>
            </thead>
            <tbody>
              {result.markets.map((market) => (
                <tr key={market.marketId} data-market-id={market.marketId}>
                  <td>{marketLabel(market.type, market.params)}</td>
                  <td>
                    <span className={`chip ${market.status === 'RESULTED' ? 'gold' : 'grey'}`}>{market.status}</span>
                  </td>
                  <td>
                    {market.type === 'TRICAST'
                      ? market.order.length
                        ? market.order.map((id) => name(id)).join(' → ')
                        : '—'
                      : market.winning.length
                        ? market.winning.map((s) => `${name(s.entrantId)} @ ${fmtPrice(s.price)}`).join(', ')
                        : market.status === 'VOID'
                          ? 'Void'
                          : 'Pending'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="fair">
          <h3>Provably fair</h3>
          <span className="small muted">The seed and script hashes were published before betting opened. Recompute them here.</span>
          <span className="tiny muted">Seed</span>
          <code>{result.seed ?? 'not revealed yet'}</code>
          <span className="tiny muted">Seed hash (SHA-256 of the 32 seed bytes)</span>
          <code>{result.seedHash ?? '—'}</code>
          <span className="tiny muted">Script hash (SHA-256 of the exact script JSON)</span>
          <code>{result.scriptHash ?? '—'}</code>
          <span className="tiny muted">Engine {result.engineVersion}</span>
          <VerifyCommitment raceId={raceId} seed={result.seed} seedHash={result.seedHash} scriptHash={result.scriptHash} />
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <h3>Replay</h3>
          {result.replay.available ? (
            <>
              <span className="small muted">Full tick replay available until {fmtDateTime(result.replay.expiresAt)}.</span>
              <div>
                <button className="btn primary" onClick={onWatchReplay} disabled={replayLoading}>
                  {replayLoading ? <Spinner /> : '▶'} Watch replay
                </button>
              </div>
            </>
          ) : (
            <span className="small muted">The replay window has passed. Results, seed and hashes stay available forever.</span>
          )}
        </div>
      </div>
    </section>
  );
}
