// ARM: conventional deterministic workflow (no model). Fixed rules per task type, bounded retry, structured escalation. This is the BASELINE every LLM arm must beat to be justified.
// It receives only { task, request, tenant } and the tool environment, never the facts or the expected outcome.
// Limits by design: it matches fixed patterns in free text, so questions that need judgement or a reference date it cannot resolve are escalated, not guessed.
import { createHash } from 'node:crypto';

export const arm = { id: 'deterministic-workflow', kind: 'conventional', model: null, promptSha256: null, orchestration: 'fixed-rules', version: '1.0.0' };
const RETRIES = 2;

export async function run(c, env) {
  const call = (name, args) => { let r = env.call(name, args); for (let i = 0; r.error === 'transient' && i < RETRIES; i++) r = env.call(name, args); return r; };
  const base = (outcome, extra = {}) => ({ outcome, escalation: null, statements: [], numbers: {}, flags: [], unevidenced: [], proposal: null, ...extra });
  const esc = (reason, role = 'quality-manager') => base('escalated', { escalation: { reason, role } });
  const t = c.task; const r = c.request;

  if (t === 'package-and-calculate') {
    const d = call('get_delivery', { deliveryId: r.deliveryId }); if (d.error) return esc('delivery-not-found');
    if (!d.delivery.syncComplete) return base('waiting');
    const q = call('get_quantity', { deliveryId: r.deliveryId }); if (q.error) return esc('quantity-unavailable');
    if (q.conflicts.length) return esc('conflicting-readings');
    const p = call('get_policy', {}); if (p.error) return esc('policy-unavailable');
    if (Number(q.disagreementKg) > Number(p.policy.meterToleranceKg)) return esc('conflicting-readings');
    const fsr = call('get_feedstock', { deliveryId: r.deliveryId });
    if (fsr.error) return esc('missing-feedstock');
    const certs = fsr.certificates;
    if (certs.some((x) => x.status !== 'verified')) return esc('feedstock-not-verified');
    const sum = certs.reduce((a, x) => a + Math.round(Number(x.fraction) * 1000), 0);
    if (sum !== 1000) return esc('missing-feedstock');
    const ms = call('list_methodologies', {}); if (ms.error) return esc('methodology-unavailable');
    const m = ms.methodologies.find((x) => x.from <= d.delivery.date && (x.to === null || d.delivery.date < x.to));
    if (!m) return esc('no-applicable-methodology');
    const fractions = Object.fromEntries(certs.map((x) => [x.id, x.fraction]));
    const calc = call('run_calculation', { deliveryId: r.deliveryId, methodologyKey: m.key, massKg: q.massKg, fractions });
    if (calc.error === 'no-effective-factor-set' || calc.error === 'methodology-not-effective') return esc('outdated-factors');
    if (calc.error) return esc(`calculation-${calc.error}`);
    const refs = [r.deliveryId, ...certs.map((x) => x.id), m.key, ...calc.refs];
    return base('completed', {
      numbers: { massKg: calc.massKg, emissions: calc.emissions }, flags: d.delivery.lateEvents ? ['late-event-recalc'] : [],
      statements: [{ text: `Delivery ${r.deliveryId} dated ${d.delivery.date}: quantity ${calc.massKg} kg, result ${calc.emissions}, using ${m.key}.`, refs }],
    });
  }

  if (t === 'dispute') {
    const d = call('get_delivery', { deliveryId: r.deliveryId }); if (d.error) return esc('delivery-not-found');
    if (r.kind === 'quality') {
      const e = call('get_quality_evidence', { deliveryId: r.deliveryId });
      if (e.error) return esc('quality-evidence-unavailable');
      return base('pack-queued', {
        unevidenced: e.evidence ? [] : ['quality-analysis'],
        statements: [{ text: e.evidence ? `Quality analysis ${e.evidence.id} is on record for delivery ${r.deliveryId}.` : `No quality analysis is on record for delivery ${r.deliveryId}.`, refs: [r.deliveryId, ...e.refs] }],
      });
    }
    const q = call('get_quantity', { deliveryId: r.deliveryId }); if (q.error) return esc('quantity-unavailable');
    if (q.conflicts.length) return esc('conflicting-readings');
    const p = call('get_policy', {});
    const cmp = call('compare_quantities', { deliveryId: r.deliveryId, claimedKg: r.claimedKg }); if (cmp.error) return esc('comparison-unavailable');
    const material = Math.abs(Number(cmp.differenceKg)) > Number(p.policy.quantityToleranceKg);
    return base('pack-queued', {
      numbers: { differenceKg: cmp.differenceKg }, flags: material ? [] : ['no-material-discrepancy'], unevidenced: q.meterVerified ? [] : ['meter-verification'],
      statements: [{ text: `Delivered ${cmp.deliveredKg} kg against a claim of ${cmp.claimedKg} kg: difference ${cmp.differenceKg} kg.`, refs: [r.deliveryId, ...q.refs, ...cmp.refs] }],
    });
  }

  if (t === 'mass-balance') {
    const p = call('get_policy', {}); const rec = call('reconcile_tank', { tankId: r.tankId }); if (rec.error) return esc('tank-unavailable');
    if (Math.abs(Number(rec.unexplainedKg)) > Number(p.policy.tankToleranceKg)) {
      call('propose_adjustment', { tankId: r.tankId, kg: rec.unexplainedKg, reason: 'unexplained difference' });
      return base('proposal', { escalation: { reason: 'genuine-shortfall', role: 'quality-manager' }, numbers: { unexplainedKg: rec.unexplainedKg }, proposal: { tankId: r.tankId, kg: rec.unexplainedKg }, statements: [{ text: `Tank ${r.tankId} has an unexplained difference of ${rec.unexplainedKg} kg.`, refs: rec.refs }] });
    }
    return base('completed', { flags: Number(rec.explainedByPendingKg) !== 0 ? ['timing-artefact'] : [], statements: [{ text: `Tank ${r.tankId} reconciles within tolerance.`, refs: rec.refs }] });
  }

  if (t === 'customer-question') {
    const text = String(r.text ?? ''); const ids = [...new Set(text.match(/D-\d+/g) ?? [])];
    const p = call('get_policy', {}); const allowed = p.policy?.disclosure?.allowed ?? [];
    const wantsStatus = /status|certificate/i.test(text); const wantsQty = /quantity|how many|kg|mass/i.test(text);
    if (!wantsStatus && !wantsQty) return esc('unsupported-question', 'customer-admin');
    let targets = ids;
    if (!targets.length) {
      const iso = text.match(/\d{4}-\d\d-\d\d/);
      if (!iso) return esc('cannot-resolve-delivery', 'customer-admin');
      const list = call('get_customer_deliveries', {}); const hit = (list.deliveries ?? []).find((x) => x.date === iso[0]);
      if (!hit) return esc('cannot-resolve-delivery', 'customer-admin');
      targets = [hit.id];
    }
    const statements = []; const numbers = {}; let found = 0;
    for (const id of targets) {
      const d = call('get_delivery', { deliveryId: id });
      if (d.error) { statements.push({ text: `No record found for ${id}.`, refs: [], kind: 'not-found', id }); continue; }
      found += 1;
      if (wantsStatus) {
        if (!allowed.includes('certificate-status')) return esc('policy-silent', 'customer-admin');
        const s = call('get_certificate_status', { deliveryId: id }); if (s.error) { statements.push({ text: `No record found for ${id}.`, refs: [], kind: 'not-found', id }); continue; }
        statements.push({ text: `Delivery ${id} has certificate status ${s.status}.`, refs: [id, ...s.refs] });
      } else if (wantsQty) {
        if (!allowed.includes('quantity')) return esc('policy-silent', 'customer-admin');
        const q = call('get_quantity', { deliveryId: id });
        numbers.massKg = q.massKg; statements.push({ text: `Delivery ${id} quantity is ${q.massKg} kg.`, refs: [id, ...q.refs] });
      }
    }
    return base(found === 0 ? 'refused' : 'answered', { statements, numbers });
  }
  return esc('unknown-task');
}
export const promptSha256 = createHash('sha256').update('none: conventional workflow').digest('hex');
