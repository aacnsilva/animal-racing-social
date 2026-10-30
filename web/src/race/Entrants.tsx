import { memo } from 'react';
import { Form, Lane } from '../components/ui';
import { fmtPrice, fmtStat, SPECIES_ICON, TEMPERAMENT_LABEL, titleCase } from '../lib/format';
import { Link } from '../lib/router';
import type { Entrant, Market } from '../lib/types';

function EntrantsInner({ entrants, winMarket }: { entrants: Entrant[]; winMarket: Market | undefined }) {
  const prices = new Map((winMarket?.selections ?? []).map((s) => [s.entrantId, s]));
  const sorted = [...entrants].sort((a, b) => a.lane - b.lane);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Runners</h2>
        <span className="small muted">Stats snapshotted when the race was scheduled</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Lane</th>
              <th>Animal</th>
              <th className="hide-sm">Style</th>
              <th className="right">Speed</th>
              <th className="right">Stamina</th>
              <th className="right hide-sm">Accel</th>
              <th className="right hide-sm">Consist.</th>
              <th>Form</th>
              <th className="right">Win</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entrant) => {
              const s = entrant.statsSnapshot;
              const win = prices.get(entrant.entrantId);
              return (
                <tr key={entrant.entrantId} data-entrant-id={entrant.entrantId}>
                  <td>
                    <Lane lane={entrant.lane} />
                  </td>
                  <td>
                    <Link to={`/animals/${entrant.animal.id}`} style={{ fontWeight: 800 }}>
                      {SPECIES_ICON[entrant.animal.species]} {entrant.animal.name}
                    </Link>
                    <div className="tiny muted">
                      {titleCase(entrant.animal.lifeStage)} · {Math.floor(entrant.animal.ageWeeks / 52)}y {entrant.animal.ageWeeks % 52}w · {entrant.animal.form.wins}/{entrant.animal.form.races} wins
                    </div>
                  </td>
                  <td className="hide-sm">
                    <span className="chip">{TEMPERAMENT_LABEL[entrant.temperament] ?? entrant.temperament}</span>
                  </td>
                  <td className="right num">{fmtStat('velocity', s.velocity)}</td>
                  <td className="right num">{fmtStat('stamina', s.stamina)}</td>
                  <td className="right num hide-sm">{fmtStat('acceleration', s.acceleration)}</td>
                  <td className="right num hide-sm">{fmtStat('consistency', s.consistency)}</td>
                  <td>
                    <Form last5={entrant.animal.form.last5} />
                  </td>
                  <td className="right num" style={{ fontWeight: 800 }}>
                    {win ? fmtPrice(win.price) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export const Entrants = memo(EntrantsInner);
