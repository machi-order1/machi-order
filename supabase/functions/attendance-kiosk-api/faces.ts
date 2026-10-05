import { MODEL, validDescriptor, matchFace } from './face-match.js';

export async function faceAction(sb: any, b: any, device: any, staffId?: number): Promise<any> {
  const action = b.action;
  if (action === 'face_enroll') {
    if (!staffId || b.consent !== true || b.model !== MODEL ||
        !Array.isArray(b.descriptors) || b.descriptors.length !== 3 ||
        !b.descriptors.every(validDescriptor))
      return { error: '顔登録の内容・同意を確認してください', status: 400 };
    // Prevent registering three unrelated faces as one person's template.
    if (b.descriptors.some((sample: number[]) =>
      Math.hypot(...sample.map((x, i) => x - b.descriptors[0][i])) > 0.4))
      return { error: '同じ顔を正面から3回撮り直してください', status: 400 };
    const { error } = await sb.from('staff_face_templates').upsert({
      staff_id: staffId, model: MODEL, descriptors: b.descriptors,
      consent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return { ok: true };
  }
  if (action === 'face_delete') {
    const { error } = await sb.from('staff_face_templates').delete().eq('staff_id', staffId);
    if (error) throw error;
    return { ok: true };
  }
  if (action === 'face_begin') {
    const { error: retentionError } = await sb.from('attendance_face_attempts').delete()
      .lt('started_at', new Date(Date.now() - 30 * 86400000).toISOString());
    if (retentionError) throw retentionError;
    const { count, error: ce } = await sb.from('attendance_face_attempts')
      .select('id', { count: 'exact', head: true }).eq('device_id', device.id)
      .gte('started_at', new Date(Date.now() - 60000).toISOString());
    if (ce) throw ce;
    if ((count || 0) >= 20) return { error: '名前を選んでPINで打刻してください', status: 429 };
    const { data, error } = await sb.from('attendance_face_attempts')
      .insert({ device_id: device.id, store_id: device.store_id })
      .select('id,started_at').single();
    if (error) throw error;
    return { attempt_id: data.id, started_at: data.started_at };
  }
  const { data: attempt, error: ae } = await sb.from('attendance_face_attempts')
    .select('id,started_at,outcome').eq('id', String(b.attempt_id || ''))
    .eq('device_id', device.id).maybeSingle();
  if (ae) throw ae;
  if (!attempt || attempt.outcome !== 'started' ||
      Date.now() - new Date(attempt.started_at).getTime() > 60000)
    return { error: '顔確認をやり直すか、名前を選んでください', status: 409 };
  let person: any = null;
  if (action === 'face_identify') {
    if (b.model !== MODEL || !validDescriptor(b.descriptor))
      return { error: '顔データを確認できませんでした', status: 400 };
    const { data: assigned, error: se } = await sb.from('staff_store_assignments')
      .select('staff_id,staff_roster!inner(id,display_name,active)')
      .eq('store_id', device.store_id).eq('active', true).eq('staff_roster.active', true);
    if (se) throw se;
    const ids = (assigned || []).map((a: any) => a.staff_id);
    if (ids.length) {
      const { data: templates, error } = await sb.from('staff_face_templates')
        .select('staff_id,descriptors').eq('model', MODEL).in('staff_id', ids);
      if (error) throw error;
      person = matchFace(b.descriptor, templates || []);
      if (person) person = (assigned || []).find((a: any) => a.staff_id === person.staff_id)?.staff_roster;
    }
  }
  const outcome = person ? 'matched' : 'fallback';
  const { data: updated, error } = await sb.from('attendance_face_attempts').update({
    outcome, matched_staff_id: person?.id || null,
    reason: action === 'face_identify' ? (person ? null : 'no_confident_match') :
      (['timeout','camera_unavailable','model_unavailable','multiple_faces','manual'].includes(b.reason) ? b.reason : 'manual'),
    finished_at: new Date().toISOString(),
  }).eq('id', attempt.id).eq('outcome', 'started').select('id').maybeSingle();
  if (error) throw error;
  if (!updated) return { error: '名前を選んでPINで打刻してください', status: 409 };
  // Never return enrolled templates to a shared kiosk. A match does not bypass PIN.
  return { ok: true, person: person ? { id: person.id, display_name: person.display_name } : null };
}
