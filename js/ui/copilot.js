/* CO-PILOT UI — Perform-tab panel + header chip + consent buttons.
 * All musical/learning logic lives in js/copilot.js + foundation/learning/
 * bandit.mjs; this module only renders state and forwards user consent.
 * The co-pilot NEVER auto-applies: every suggestion requires APPLY.
 */
import { $, I, toast } from '../state.js';
import { copilotInit, copilotInstrument, copilotGesture, copilotApply, copilotDismiss, copilotVote, copilotToggleLearn, copilotBarHook, copilotStats, actionLabel } from '../copilot.js';

function renderCopilot() {
  const c = I.cop;
  if (!c) return;
  const st = copilotStats();
  const chip = $('copChip');
  if (chip) { chip.textContent = '✦ CO-PILOT ' + (c.learn ? 'ON' : 'OFF'); chip.classList.toggle('st', c.learn); }
  const lb = $('bLearn');
  if (lb) lb.textContent = c.learn ? 'LEARN ON' : 'LEARN OFF';
  const body = $('copBody');
  if (body) {
    if (!c.learn) body.innerHTML = '<span class="note">LEARN OFF — co-pilot fully inert (no decisions, no suggestions).</span>';
    else if (!st.sug) body.innerHTML = '<span class="note">No suggestion — abstaining. DO_NOTHING is legal and common early on.</span>';
    else {
      const s = st.sug, d = s.decision;
      const exp = d.expectedReward == null ? '—' : (d.expectedReward >= 0 ? '+' : '') + d.expectedReward.toFixed(2);
      const tgt = d.action.to ? ' → ' + d.action.to : (d.action.layer ? ' → ' + d.action.layer : '');
      body.innerHTML = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
        + '<b>' + actionLabel(d.action) + '</b><span class="mono" style="font-size:9px">' + tgt + '</span>'
        + '<span class="tag">exp ' + exp + '</span><span class="tag">conf ' + Math.round(d.confidence * 100) + '%</span><span class="tag">' + d.reason + '</span>'
        + '<button id="copApply">APPLY</button><button id="copDismiss">DISMISS</button>'
        + '<button id="copUp" title="good suggestion">👍</button><button id="copDown" title="bad suggestion">👎</button>'
        + (s.applied && !s.resolved ? '<span class="note">applied — reward window open (2 bars)</span>' : '')
        + '</div>';
      $('copApply').onclick = copilotApply;
      $('copDismiss').onclick = copilotDismiss;
      $('copUp').onclick = function () { copilotVote(1); };
      $('copDown').onclick = function () { copilotVote(-1); };
    }
  }
  const stats = $('copStats');
  if (stats) stats.textContent = 'decisions ' + st.decisions + ' · applies ' + st.applies + ' · do-nothing ' + Math.round(st.doNothingRate * 100) + '% · top: ' + st.top;
}

function wireCopilot() {
  copilotInit();
  copilotInstrument();
  I.barHooks.push(copilotBarHook);
  I.copilotRender = renderCopilot;
  I.copilotToast = function (m) { toast(m); };
  I.copilotSyncGroove = function () { const gs = $('grooveSel'); if (gs && I.p) gs.value = I.p.groove; };
  /* wrap PANIC/UNDO header handlers: original behavior first-class, gesture recorded for the reward window */
  const wrap = function (id, kind) {
    const b = $(id);
    if (!b) return;
    const orig = b.onclick;
    b.onclick = function (e) { copilotGesture(kind); if (orig) orig.call(this, e); };
  };
  wrap('bPanic', 'panic');
  wrap('bUndo', 'undo');
  const bl = $('bLearn');
  if (bl) bl.onclick = function () { copilotToggleLearn(); };
  renderCopilot();
}

export { wireCopilot, renderCopilot };
