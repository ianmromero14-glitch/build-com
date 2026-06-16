import { useState, useEffect, useCallback, useRef } from "react";
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://16553aefa9b446bb357a046ad85f06f9@o4511527733755904.ingest.us.sentry.io/4511527740899328",
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
});

const SUPABASE_URL = "https://zbvxrwftgtiwtlqzgztv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpidnhyd2Z0Z3Rpd3RscXpnenR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NzU4NDgsImV4cCI6MjA5NjM1MTg0OH0.uuyQAAeJxtlf6FzjRMEUvdfTy5VD3j3mfy8G_lXx_ag";

const LEAD_STAGES = ["Lead", "Inspection", "Proposal Sent", "Sold", "Lost"];
const JOB_STAGES = ["In Production", "Invoiced", "Complete", "Cancelled"];
const stageColors = {
  "Lead": "bg-blue-100 text-blue-700", "Inspection": "bg-purple-100 text-purple-700",
  "Proposal Sent": "bg-yellow-100 text-yellow-700", "Sold": "bg-green-100 text-green-700",
  "Lost": "bg-red-100 text-red-700", "In Production": "bg-orange-100 text-orange-700",
  "Invoiced": "bg-blue-100 text-blue-700", "Complete": "bg-green-100 text-green-700",
  "Cancelled": "bg-red-100 text-red-700",
};
const stageIcon = {
  "Lead": "👤", "Inspection": "🔍", "Proposal Sent": "📋", "Sold": "🤝", "Lost": "❌",
  "In Production": "🏗️", "Invoiced": "💰", "Complete": "✅", "Cancelled": "🚫",
};
const DEFAULT_TASKS = ["Pull permit", "Order materials", "Assign crew", "Schedule start date", "Quality inspection", "Take completion photos", "Send invoice"];

// ─── EMAIL ────────────────────────────────────────────────────────────────────
async function sendEmail(subject, html) {
  try {
    await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, html }) });
  } catch (e) { Sentry.captureException(e); }
}
async function sendAccessRequestEmail(full_name, email, reason) {
  await sendEmail(`🔔 New Access Request from ${full_name}`,
    `<div style="font-family:sans-serif;padding:24px;"><h2>New Access Request</h2><p><b>Name:</b> ${full_name}</p><p><b>Email:</b> ${email}</p><p><b>Reason:</b> ${reason}</p><a href="https://build-com-topaz.vercel.app">Open Admin Panel</a></div>`);
}
async function sendRecommendationEmail(from_name, category, message) {
  await sendEmail(`💡 New Recommendation: ${category}`,
    `<div style="font-family:sans-serif;padding:24px;"><h2>New Recommendation</h2><p><b>From:</b> ${from_name}</p><p><b>Category:</b> ${category}</p><p>${message}</p></div>`);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || data.msg || JSON.stringify(data));
  return data;
}
async function signOut(token) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` } });
}
async function getProfile(userId, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` } });
  const data = await res.json(); return data[0] || null;
}

// ─── DB ───────────────────────────────────────────────────────────────────────
function makeDb(token) {
  async function sbFetch(table, method = "GET", body = null, query = "") {
    const headers = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": method === "POST" ? "return=representation" : "" };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { method, headers, body: body ? JSON.stringify(body) : null });
    if (!res.ok) { const e = await res.text(); throw new Error(e); }
    if (method === "DELETE" || res.status === 204) return null;
    return res.json();
  }
  return {
    list: (table, query = "select=*&order=created_at.desc") => sbFetch(table, "GET", null, query),
    insert: (table, data) => sbFetch(table, "POST", data),
    update: (table, id, data) => sbFetch(table, "PATCH", data, `id=eq.${id}`),
    delete: (table, id) => sbFetch(table, "DELETE", null, `id=eq.${id}`),
  };
}

// ─── ACTIVITY LOG ─────────────────────────────────────────────────────────────
async function logActivity(relatedId, relatedType, action, detail, userName) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/activity_log`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ related_id: relatedId, related_type: relatedType, action, detail, user_name: userName }),
    });
  } catch (e) { console.error("Activity log failed:", e); }
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────
async function uploadFile(token, file, relatedId, relatedType, db) {
  const ext = file.name.split(".").pop();
  const path = `${relatedType}/${relatedId}/${Date.now()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/job-files/${path}`, {
    method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": file.type }, body: file,
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const url = `${SUPABASE_URL}/storage/v1/object/public/job-files/${path}`;
  await db.insert("files", { name: file.name, url, type: file.type, related_id: relatedId, related_type: relatedType });
  return url;
}

// ─── LOGO ─────────────────────────────────────────────────────────────────────
function TetrahedronMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="12" fill="#1C1F22"/>
      <g transform="translate(20,32)">
        <polygon points="0,-22 -16,-4 16,-4" fill="#4B5563"/>
        <polygon points="0,-22 -16,-4 0,-4" fill="#374151"/>
        <polygon points="0,-22 16,-4 0,-4" fill="#6B7280"/>
        <line x1="0" y1="-22" x2="0" y2="-4" stroke="#9CA3AF" strokeWidth="1"/>
        <polygon points="0,22 -16,4 16,4" fill="#4B5563"/>
        <polygon points="0,22 -16,4 0,4" fill="#374151"/>
        <polygon points="0,22 16,4 0,4" fill="#6B7280"/>
        <line x1="0" y1="22" x2="0" y2="4" stroke="#9CA3AF" strokeWidth="1"/>
        <polygon points="-16,-4 -26,0 -16,4" fill="#4B5563"/>
        <polygon points="16,-4 24,0 16,4" fill="#4B5563"/>
        <polygon points="-10,-14 -20,-20 -4,-8" fill="#6B7280"/>
        <polygon points="10,-14 20,-20 4,-8" fill="#9CA3AF"/>
        <polygon points="-10,14 -20,20 -4,8" fill="#6B7280"/>
        <polygon points="10,14 20,20 4,8" fill="#9CA3AF"/>
        <polygon points="0,-4 -6,-2 -6,2 0,4 6,2 6,-2" fill="#D1D5DB"/>
        <circle cx="0" cy="0" r="2.5" fill="white"/>
      </g>
      <text x="38" y="28" fontFamily="'DM Sans',Arial,sans-serif" fontSize="11" fontWeight="700" fill="white" textAnchor="start" letterSpacing="1">SIMP</text>
      <text x="38" y="42" fontFamily="'DM Sans',Arial,sans-serif" fontSize="11" fontWeight="700" fill="#6B7280" textAnchor="start" letterSpacing="1">LICITY</text>
      <line x1="38" y1="31" x2="62" y2="31" stroke="#374151" strokeWidth="0.8"/>
    </svg>
  );
}
function TetrahedronLogin() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
      <rect width="120" height="120" rx="24" fill="#1C1F22"/>
      <g transform="translate(42,60)">
        <polygon points="0,-38 -28,-6 28,-6" fill="#4B5563"/>
        <polygon points="0,-38 -28,-6 0,-6" fill="#374151"/>
        <polygon points="0,-38 28,-6 0,-6" fill="#6B7280"/>
        <line x1="0" y1="-38" x2="0" y2="-6" stroke="#9CA3AF" strokeWidth="1.5"/>
        <polygon points="0,38 -28,6 28,6" fill="#4B5563"/>
        <polygon points="0,38 -28,6 0,6" fill="#374151"/>
        <polygon points="0,38 28,6 0,6" fill="#6B7280"/>
        <line x1="0" y1="38" x2="0" y2="6" stroke="#9CA3AF" strokeWidth="1.5"/>
        <polygon points="-28,-6 -44,0 -28,6" fill="#4B5563"/>
        <polygon points="28,-6 42,0 28,6" fill="#4B5563"/>
        <polygon points="-18,-22 -36,-34 -6,-12" fill="#6B7280"/>
        <polygon points="18,-22 36,-34 6,-12" fill="#9CA3AF"/>
        <polygon points="-18,22 -36,34 -6,12" fill="#6B7280"/>
        <polygon points="18,22 36,34 6,12" fill="#9CA3AF"/>
        <polygon points="0,-6 -10,-3 -10,3 0,6 10,3 10,-3" fill="#D1D5DB"/>
        <circle cx="0" cy="0" r="4" fill="white"/>
      </g>
      <text x="68" y="52" fontFamily="'DM Sans',Arial,sans-serif" fontSize="18" fontWeight="700" fill="white" textAnchor="start" letterSpacing="2">SIMP</text>
      <text x="68" y="74" fontFamily="'DM Sans',Arial,sans-serif" fontSize="18" fontWeight="700" fill="#6B7280" textAnchor="start" letterSpacing="2">LICITY</text>
      <line x1="68" y1="56" x2="114" y2="56" stroke="#374151" strokeWidth="1"/>
    </svg>
  );
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
const statusColors = {
  New: "bg-blue-100 text-blue-700", Contacted: "bg-yellow-100 text-yellow-700",
  Qualified: "bg-green-100 text-green-700", Lost: "bg-red-100 text-red-700",
  Pending: "bg-gray-100 text-gray-600", Scheduled: "bg-blue-100 text-blue-700",
  "In Progress": "bg-orange-100 text-orange-700", Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700", Draft: "bg-gray-100 text-gray-600",
  Sent: "bg-blue-100 text-blue-700", Approved: "bg-green-100 text-green-700",
  Declined: "bg-red-100 text-red-700", Paid: "bg-emerald-100 text-emerald-700",
  Done: "bg-green-100 text-green-700", High: "bg-red-100 text-red-700",
  Medium: "bg-yellow-100 text-yellow-700", Low: "bg-gray-100 text-gray-600",
  admin: "bg-gray-700 text-gray-100", member: "bg-gray-100 text-gray-600",
  "Under Review": "bg-yellow-100 text-yellow-700", Implemented: "bg-green-100 text-green-700",
};
const priorityDot = { High: "bg-red-500", Medium: "bg-yellow-400", Low: "bg-gray-400" };

function Badge({ label }) {
  const cls = stageColors[label] || statusColors[label] || "bg-gray-100 text-gray-600";
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{label}</span>;
}
function Spinner() {
  return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-gray-200 border-t-gray-600 rounded-full animate-spin"></div></div>;
}
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-hidden max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, value, onChange, type = "text", options, disabled }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {options ? (
        <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white disabled:opacity-50">
          {options.map(o => <option key={o}>{o}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none" />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50" />
      )}
    </div>
  );
}
const btnPrimary = "bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors";
const btnSm = "bg-gray-800 hover:bg-gray-700 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors";

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────
function ActivityFeed({ relatedId, relatedType }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/activity_log?related_id=eq.${relatedId}&order=created_at.desc&limit=20`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      setActivities(await res.json());
    } catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [relatedId]);
  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await logActivity(relatedId, relatedType, "Note", note, "You");
      setNote("");
      await load();
    } catch (e) { Sentry.captureException(e); }
    finally { setSaving(false); }
  };

  const actionIcon = { "Note": "📝", "Stage Change": "🔄", "Created": "✨", "Inspection": "🔍", "Proposal": "📋", "Converted": "🚀", "Photo": "📸", "Document": "📄" };

  return (
    <div>
      <div className="mb-4">
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
          placeholder="Log a call, note, or update..."
          style={{ fontSize: 16 }}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-gray-400 resize-none bg-white" />
        <button onClick={addNote} disabled={saving || !note.trim()} className={`w-full ${btnPrimary} mt-2`}>
          {saving ? "Saving..." : "📝 Log Note"}
        </button>
      </div>
      {loading ? <Spinner /> : (
        <div className="space-y-3">
          {activities.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No activity yet</p>}
          {activities.map(a => (
            <div key={a.id} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm flex-shrink-0">
                {actionIcon[a.action] || "-"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700">{a.action}</span>
                  <span className="text-xs text-gray-400">{a.user_name}</span>
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{a.detail}</p>
                <p className="text-xs text-gray-400 mt-0.5">{new Date(a.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FILE PANEL ───────────────────────────────────────────────────────────────
function FilePanel({ relatedId, relatedType, token, db }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef();
  const cameraRef = useRef();

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try { setFiles(await db.list("files", `select=*&related_id=eq.${relatedId}&order=created_at.desc`)); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db, relatedId]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleUpload = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setUploading(true);
    try { for (const file of selected) await uploadFile(token, file, relatedId, relatedType, db); await loadFiles(); }
    catch (err) { Sentry.captureException(err); alert("Upload failed: " + err.message); }
    finally { setUploading(false); }
  };

  const deleteFile = async (file) => {
    if (!confirm("Delete this file?")) return;
    try { await db.delete("files", file.id); setFiles(files.filter(f => f.id !== file.id)); }
    catch (e) { Sentry.captureException(e); }
  };

  const isImage = (f) => f.type?.startsWith("image/");
  const photos = files.filter(isImage);
  const docs = files.filter(f => !isImage(f));

  return (
    <div>
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <button onClick={() => cameraRef.current.click()} disabled={uploading} className={`${btnSm} flex items-center gap-2`}>
          {uploading ? "Uploading..." : "📷 Take Photo"}
        </button>
        <button onClick={() => fileRef.current.click()} disabled={uploading}
          className="border-2 border-gray-300 hover:border-gray-500 text-gray-700 font-semibold px-4 py-2 rounded-xl text-sm bg-white flex items-center gap-2">
          📎 Upload File
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleUpload} />
        <input ref={fileRef} type="file" multiple className="hidden" onChange={handleUpload} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
      </div>
      {loading ? <Spinner /> : (
        <>
          {photos.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-gray-700 mb-3">📸 Photos ({photos.length})</h4>
              <div className="grid grid-cols-3 gap-2">
                {photos.map(f => (
                  <div key={f.id} className="relative group rounded-xl overflow-hidden aspect-square bg-gray-100">
                    <img src={f.url} alt={f.name} className="w-full h-full object-cover cursor-pointer" onClick={() => setLightbox(f)} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button onClick={() => setLightbox(f)} className="bg-white rounded-full p-1.5 text-xs">🔍</button>
                      <button onClick={() => deleteFile(f)} className="bg-white rounded-full p-1.5 text-red-500 text-xs">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {docs.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-bold text-gray-700 mb-3">📄 Documents ({docs.length})</h4>
              <div className="space-y-2">
                {docs.map(f => (
                  <div key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                    <span className="text-2xl">📄</span>
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{f.name}</p></div>
                    <a href={f.url} target="_blank" rel="noreferrer" className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200">Open</a>
                    <button onClick={() => deleteFile(f)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {files.length === 0 && (
            <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-2xl">
              <p className="text-gray-400 text-sm">No files yet</p>
            </div>
          )}
        </>
      )}
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.name} className="w-full max-h-[80vh] object-contain rounded-xl" />
            <div className="flex items-center justify-between mt-3">
              <p className="text-white text-sm">{lightbox.name}</p>
              <button onClick={() => setLightbox(null)} className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PRODUCTION TASKS ─────────────────────────────────────────────────────────
function ProductionTasks({ jobId, db }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setTasks(await db.list("pipeline_tasks", `select=*&job_id=eq.${jobId}&order=created_at.asc`)); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db, jobId]);
  useEffect(() => { load(); }, [load]);

  const addTask = async (title) => {
    if (!title.trim()) return;
    try { const [created] = await db.insert("pipeline_tasks", { job_id: jobId, title: title.trim(), status: "Pending" }); setTasks([...tasks, created]); setNewTask(""); }
    catch (e) { Sentry.captureException(e); }
  };
  const toggleTask = async (task) => {
    const newStatus = task.status === "Done" ? "Pending" : "Done";
    setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    try { await db.update("pipeline_tasks", task.id, { status: newStatus }); } catch (e) { Sentry.captureException(e); load(); }
  };
  const deleteTask = async (id) => {
    setTasks(tasks.filter(t => t.id !== id));
    try { await db.delete("pipeline_tasks", id); } catch (e) { Sentry.captureException(e); load(); }
  };

  const done = tasks.filter(t => t.status === "Done").length;
  return (
    <div>
      {tasks.length > 0 && (
        <div className="mb-4">
          <div className="flex justify-between mb-1"><span className="text-xs text-gray-500">{done}/{tasks.length} done</span><span className="text-xs text-gray-400">{Math.round((done / tasks.length) * 100)}%</span></div>
          <div className="w-full bg-gray-100 rounded-full h-2 mb-4"><div className="bg-gray-800 h-2 rounded-full" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></div>
        </div>
      )}
      <div className="space-y-2 mb-4">
        {loading ? <Spinner /> : tasks.map(task => (
          <div key={task.id} className={`flex items-center gap-3 p-3 rounded-xl border ${task.status === "Done" ? "bg-gray-50 border-gray-100 opacity-60" : "bg-white border-gray-100"}`}>
            <button onClick={() => toggleTask(task)} className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${task.status === "Done" ? "bg-gray-800 border-gray-800" : "border-gray-300 hover:border-gray-600"}`}>
              {task.status === "Done" && <span className="text-white text-xs">✓</span>}
            </button>
            <span className={`flex-1 text-sm ${task.status === "Done" ? "line-through text-gray-400" : "text-gray-800"}`}>{task.title}</span>
            <button onClick={() => deleteTask(task.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        <input value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="Add a task..."
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          onKeyDown={e => e.key === "Enter" && addTask(newTask)} />
        <button onClick={() => addTask(newTask)} className={btnSm}>Add</button>
      </div>
      {tasks.length === 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-2">Quick add default tasks:</p>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_TASKS.map(t => <button key={t} onClick={() => addTask(t)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg">+ {t}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LEAD DETAIL MODAL ────────────────────────────────────────────────────────
function LeadDetailModal({ lead, db, token, teamMembers, profile, onClose, onUpdate, onConvert }) {
  const [activeTab, setActiveTab] = useState("pipeline");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    stage: lead.stage || "Lead",
    inspection_date: lead.inspection_date ? lead.inspection_date.slice(0, 16) : "",
    proposal_amount: lead.proposal_amount || "",
    proposal_status: lead.proposal_status || "Draft",
    follow_up_date: lead.follow_up_date ? lead.follow_up_date.slice(0, 16) : "",
  });

  const saveField = async (field, value) => {
    try {
      await db.update("leads", lead.id, { [field]: value });
      onUpdate({ ...lead, [field]: value });
      if (field === "stage") await logActivity(lead.id, "lead", "Stage Change", `Stage changed to ${value}`, profile?.full_name || "Admin");
    } catch (e) { Sentry.captureException(e); alert(e.message); }
  };

  const tabs = ["pipeline", "activity", "proposal", "photos", "documents"];

  return (
    <Modal title={lead.name} onClose={onClose} wide>
      {/* Stage dropdown */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pipeline Stage</label>
        <select value={form.stage} onChange={async e => { setForm({ ...form, stage: e.target.value }); await saveField("stage", e.target.value); }}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white">
          {LEAD_STAGES.map(s => <option key={s} value={s}>{stageIcon[s]} {s}</option>)}
        </select>
      </div>

      {form.stage === "Sold" && (
        <button onClick={() => onConvert(lead)} className="w-full mb-4 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
          🚀 Convert to Job
        </button>
      )}

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${activeTab === t ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "activity" ? "📋 Activity" : t === "photos" ? "📸 Photos" : t === "documents" ? "📄 Docs" : t === "proposal" ? "💰 Proposal" : "🔍 Details"}
          </button>
        ))}
      </div>

      {activeTab === "pipeline" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Email</p><p className="text-sm font-medium truncate">{lead.email || "—"}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Phone</p><p className="text-sm font-medium">{lead.phone || "—"}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Source</p><p className="text-sm font-medium">{lead.source || "—"}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Stage</p><Badge label={form.stage} /></div>
          </div>
          {lead.address && <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Address</p><p className="text-sm font-medium">{lead.address}</p></div>}
          {lead.assigned_name && <div className="bg-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400">Assigned To</p><p className="text-sm font-semibold text-white">👤 {lead.assigned_name}</p></div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">📅 Inspection Date & Time</label>
            <input type="datetime-local" value={form.inspection_date}
              onChange={async e => { setForm({ ...form, inspection_date: e.target.value }); await saveField("inspection_date", e.target.value || null); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">🔔 Follow-Up Date</label>
            <input type="datetime-local" value={form.follow_up_date}
              onChange={async e => { setForm({ ...form, follow_up_date: e.target.value }); await saveField("follow_up_date", e.target.value || null); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
            <p className="text-xs text-gray-400 mt-1">You'll see this on the calendar as a reminder</p>
          </div>
        </div>
      )}
      {activeTab === "activity" && <ActivityFeed relatedId={lead.id} relatedType="lead" />}
      {activeTab === "proposal" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Proposal Amount ($)</label>
            <input type="number" value={form.proposal_amount} onChange={e => setForm({ ...form, proposal_amount: e.target.value })}
              onBlur={async () => await saveField("proposal_amount", parseFloat(form.proposal_amount) || null)}
              placeholder="0.00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Proposal Status</label>
            <select value={form.proposal_status}
              onChange={async e => { setForm({ ...form, proposal_status: e.target.value }); await saveField("proposal_status", e.target.value); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
              {["Draft", "Sent", "Accepted", "Declined"].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          {form.proposal_amount && (
            <div className="bg-gray-800 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-400 mb-1">Proposal Value</p>
              <p className="text-3xl font-bold text-white">${Number(form.proposal_amount).toLocaleString()}</p>
              <Badge label={form.proposal_status} />
            </div>
          )}
        </div>
      )}
      {activeTab === "photos" && <FilePanel relatedId={lead.id} relatedType="lead-photos" token={token} db={db} />}
      {activeTab === "documents" && <FilePanel relatedId={lead.id} relatedType="lead-docs" token={token} db={db} />}
    </Modal>
  );
}

// ─── JOB DETAIL MODAL ─────────────────────────────────────────────────────────
function JobDetailModal({ job, db, token, profile, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [notes, setNotes] = useState(job.notes || "");
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState(job.stage || "In Production");

  const saveField = async (field, value) => {
    try {
      await db.update("jobs", job.id, { [field]: value });
      onUpdate({ ...job, [field]: value });
      if (field === "stage") await logActivity(job.id, "job", "Stage Change", `Stage changed to ${value}`, profile?.full_name || "Admin");
    } catch (e) { Sentry.captureException(e); alert(e.message); }
  };

  const saveNotes = async () => {
    setSaving(true);
    try {
      await db.update("jobs", job.id, { notes });
      onUpdate({ ...job, notes });
      await logActivity(job.id, "job", "Note", notes, profile?.full_name || "Admin");
      alert("✅ Notes saved!");
    } catch (e) { Sentry.captureException(e); alert("❌ Error: " + e.message); }
    finally { setSaving(false); }
  };

  const tabs = ["overview", "activity", "tasks", "photos", "documents", "notes"];

  return (
    <Modal title={job.title} onClose={onClose} wide>
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Job Stage</label>
        <select value={stage} onChange={async e => { setStage(e.target.value); await saveField("stage", e.target.value); }}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white">
          {JOB_STAGES.map(s => <option key={s} value={s}>{stageIcon[s]} {s}</option>)}
        </select>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${activeTab === t ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "activity" ? "📋" : t === "photos" ? "📸" : t === "documents" ? "📄" : t === "notes" ? "📝" : t === "tasks" ? "✅" : "ℹ️"} {t}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Customer</p><p className="text-sm font-medium">{job.customer || "—"}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Type</p><p className="text-sm font-medium">{job.type || "—"}</p></div>
            <div className="bg-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400">Value</p><p className="text-lg font-bold text-white">${Number(job.value || 0).toLocaleString()}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Stage</p><Badge label={stage} /></div>
          </div>
          {job.address && <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Address</p><p className="text-sm font-medium">{job.address}</p></div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Crew</label>
            <input defaultValue={job.crew || ""} onBlur={e => saveField("crew", e.target.value)} placeholder="Assign crew..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Materials</label>
            <input defaultValue={job.materials || ""} onBlur={e => saveField("materials", e.target.value)} placeholder="Materials needed..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Permit #</label>
            <input defaultValue={job.permit || ""} onBlur={e => saveField("permit", e.target.value)} placeholder="Permit number..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" /></div>
        </div>
      )}
      {activeTab === "activity" && <ActivityFeed relatedId={job.id} relatedType="job" />}
      {activeTab === "tasks" && <ProductionTasks jobId={job.id} db={db} />}
      {activeTab === "photos" && <FilePanel relatedId={job.id} relatedType="job-photos" token={token} db={db} />}
      {activeTab === "documents" && <FilePanel relatedId={job.id} relatedType="job-docs" token={token} db={db} />}
      {activeTab === "notes" && (
        <div>
          <p className="text-xs text-gray-400 mb-2">Type your notes below and tap Save when done.</p>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={10} placeholder="Type your notes here..."
            style={{ fontSize: 16 }}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-gray-400 resize-none mb-3 bg-white" />
          <button onClick={saveNotes} disabled={saving} className={`w-full ${btnPrimary}`}>{saving ? "Saving..." : "💾 Save Notes"}</button>
          {notes && <p className="text-xs text-gray-400 text-center mt-2">{notes.length} characters</p>}
        </div>
      )}
    </Modal>
  );
}

// ─── DRAG & DROP KANBAN BOARD ─────────────────────────────────────────────────
function KanbanBoard({ leads, onSelectLead, onStageChange, teamMembers, profile }) {
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const isAdmin = profile?.role === "admin";

  const handleDragStart = (e, leadId) => {
    setDragId(leadId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, stage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(stage);
  };

  const handleDrop = async (e, stage) => {
    e.preventDefault();
    if (dragId && stage) {
      await onStageChange(dragId, stage);
    }
    setDragId(null);
    setDragOver(null);
  };

  const handleDragEnd = () => { setDragId(null); setDragOver(null); };

  // Touch drag support
  const touchLead = useRef(null);
  const handleTouchStart = (leadId) => { touchLead.current = leadId; };
  const handleTouchEnd = async (e, stage) => {
    if (touchLead.current && stage) {
      await onStageChange(touchLead.current, stage);
    }
    touchLead.current = null;
  };

  return (
    <div className="overflow-x-auto pb-4 -mx-4 px-4">
      <div className="flex gap-3 min-w-max">
        {LEAD_STAGES.map(stage => {
          const stageLeads = leads.filter(l => (l.stage || "Lead") === stage);
          const isOver = dragOver === stage;
          return (
            <div key={stage} className="w-64 flex-shrink-0"
              onDragOver={e => handleDragOver(e, stage)}
              onDrop={e => handleDrop(e, stage)}
              onDragLeave={() => setDragOver(null)}>
              {/* Column header */}
              <div className={`flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg transition-colors ${isOver ? "bg-gray-200" : ""}`}>
                <span>{stageIcon[stage]}</span>
                <span className="font-semibold text-sm text-gray-700">{stage}</span>
                <span className="ml-auto bg-gray-200 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">{stageLeads.length}</span>
              </div>
              {/* Drop zone */}
              <div className={`min-h-24 rounded-2xl transition-all ${isOver ? "bg-gray-100 border-2 border-dashed border-gray-400" : "bg-gray-50/50"} p-2 space-y-2`}>
                {stageLeads.map(lead => (
                  <div key={lead.id}
                    draggable
                    onDragStart={e => handleDragStart(e, lead.id)}
                    onDragEnd={handleDragEnd}
                    onTouchStart={() => handleTouchStart(lead.id)}
                    className={`bg-white rounded-xl border border-gray-100 shadow-sm p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all ${dragId === lead.id ? "opacity-50 scale-95" : ""}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{lead.name?.[0] || "?"}</div>
                      <span className="font-medium text-sm text-gray-900 truncate flex-1">{lead.name}</span>
                      <button onClick={() => onSelectLead(lead)} className="text-xs text-gray-400 hover:text-gray-700 flex-shrink-0">→</button>
                    </div>
                    {lead.proposal_amount && <p className="text-sm font-bold text-gray-800">${Number(lead.proposal_amount).toLocaleString()}</p>}
                    {lead.inspection_date && <p className="text-xs text-gray-400 mt-1">🔍 {new Date(lead.inspection_date).toLocaleDateString()}</p>}
                    {lead.follow_up_date && <p className="text-xs text-orange-500 mt-0.5">🔔 {new Date(lead.follow_up_date).toLocaleDateString()}</p>}
                    {lead.assigned_name && <p className="text-xs text-gray-400 mt-0.5">👤 {lead.assigned_name}</p>}
                    {/* Stage quick-move buttons */}
                    <div className="flex gap-1 mt-2">
                      {LEAD_STAGES.filter(s => s !== stage).slice(0, 2).map(s => (
                        <button key={s} onClick={() => onStageChange(lead.id, s)}
                          className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full transition-colors truncate">
                          → {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {stageLeads.length === 0 && (
                  <div className="text-center py-8 text-gray-300 text-xs">
                    {isOver ? "Drop here" : "No leads"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function CalendarView({ db }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [leads, jobs, tasks] = await Promise.all([
          db.list("leads", "select=*&order=created_at.desc"),
          db.list("jobs", "select=*&order=created_at.desc"),
          db.list("tasks", "select=*&order=due.asc"),
        ]);
        const allEvents = [
          ...leads.filter(l => l.inspection_date).map(l => ({ date: new Date(l.inspection_date), label: `🔍 ${l.name}`, color: "bg-purple-100 text-purple-700", type: "inspection" })),
          ...leads.filter(l => l.follow_up_date).map(l => ({ date: new Date(l.follow_up_date), label: `🔔 Follow up: ${l.name}`, color: "bg-orange-100 text-orange-700", type: "followup" })),
          ...jobs.filter(j => j.start_date).map(j => ({ date: new Date(j.start_date), label: `🏗️ ${j.title}`, color: "bg-blue-100 text-blue-700", type: "job" })),
          ...tasks.filter(t => t.due && t.status === "Pending").map(t => ({ date: new Date(t.due), label: `✅ ${t.title}`, color: "bg-gray-100 text-gray-700", type: "task" })),
        ];
        setEvents(allEvents);
      } catch (e) { Sentry.captureException(e); }
      finally { setLoading(false); }
    }
    load();
  }, [db]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });

  const getEventsForDay = (day) => {
    return events.filter(e => {
      const d = e.date;
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  };

  const today = new Date();
  const isToday = (day) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Calendar</h2><p className="text-sm text-gray-500 mt-0.5">Inspections, jobs & follow-ups</p></div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">‹</button>
          <span className="text-sm font-semibold text-gray-700 min-w-32 text-center">{monthName}</span>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">›</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full bg-purple-400"></span>Inspection</span>
        <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full bg-orange-400"></span>Follow-up</span>
        <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full bg-blue-400"></span>Job Start</span>
        <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full bg-gray-400"></span>Task Due</span>
      </div>

      {loading ? <Spinner /> : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} className="text-center text-xs font-semibold text-gray-400 py-3">{d}</div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-16 border-b border-r border-gray-50 bg-gray-50/50" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayEvents = getEventsForDay(day);
              return (
                <div key={day} className={`min-h-16 border-b border-r border-gray-50 p-1 ${isToday(day) ? "bg-gray-800" : "hover:bg-gray-50"}`}>
                  <p className={`text-xs font-semibold mb-1 ${isToday(day) ? "text-white" : "text-gray-700"}`}>{day}</p>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 2).map((ev, idx) => (
                      <div key={idx} className={`text-[10px] px-1 py-0.5 rounded truncate ${ev.color}`}>{ev.label}</div>
                    ))}
                    {dayEvents.length > 2 && <p className="text-[10px] text-gray-400">+{dayEvents.length - 2} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming events list */}
      <div className="mt-6">
        <h3 className="font-bold text-gray-900 mb-3">Upcoming This Month</h3>
        <div className="space-y-2">
          {events.filter(e => e.date.getMonth() === month && e.date.getFullYear() === year && e.date >= today)
            .sort((a, b) => a.date - b.date)
            .slice(0, 10)
            .map((ev, i) => (
              <div key={i} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 p-3">
                <div className="text-center flex-shrink-0 w-10">
                  <p className="text-xs text-gray-400">{ev.date.toLocaleString("default", { month: "short" })}</p>
                  <p className="text-lg font-bold text-gray-900 leading-none">{ev.date.getDate()}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${ev.color}`}>{ev.label}</span>
              </div>
            ))}
          {events.filter(e => e.date.getMonth() === month && e.date >= today).length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Nothing scheduled this month</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── LEADS ───────────────────────────────────────────────────────────────────
function LeadsView({ db, token, profile }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [teamMembers, setTeamMembers] = useState([]);
  const [view, setView] = useState("board");
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", source: "Referral", stage: "Lead", notes: "", assigned_to: "", assigned_name: "" });
  const isAdmin = profile?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsData, members] = await Promise.all([db.list("leads"), db.list("profiles", "select=*&order=full_name.asc")]);
      setLeads(leadsData); setTeamMembers(members);
    } catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = leads.filter(l =>
    l.name?.toLowerCase().includes(search.toLowerCase()) ||
    l.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleStageChange = async (leadId, newStage) => {
    setLeads(leads.map(l => l.id === leadId ? { ...l, stage: newStage } : l));
    try {
      await db.update("leads", leadId, { stage: newStage });
      const lead = leads.find(l => l.id === leadId);
      await logActivity(leadId, "lead", "Stage Change", `Moved to ${newStage}`, profile?.full_name || "Admin");
    } catch (e) { Sentry.captureException(e); load(); }
  };

  const addLead = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.assigned_to) { delete payload.assigned_to; delete payload.assigned_name; }
      const [created] = await db.insert("leads", payload);
      await logActivity(created.id, "lead", "Created", `Lead created for ${form.name}`, profile?.full_name || "Admin");
      setLeads([created, ...leads]);
      setForm({ name: "", phone: "", email: "", address: "", source: "Referral", stage: "Lead", notes: "", assigned_to: "", assigned_name: "" });
      setShowModal(false);
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const handleConvert = async (lead) => {
    try {
      const [newJob] = await db.insert("jobs", {
        title: `${lead.name} - ${lead.source || "Job"}`,
        customer: lead.name, address: lead.address || "",
        status: "In Progress", stage: "In Production", type: "Other",
        value: lead.proposal_amount || 0, notes: lead.notes || "",
      });
      for (const task of DEFAULT_TASKS) await db.insert("pipeline_tasks", { job_id: newJob.id, title: task, status: "Pending" });
      await db.update("leads", lead.id, { stage: "Sold" });
      await logActivity(lead.id, "lead", "Converted", `Converted to job: ${newJob.title}`, profile?.full_name || "Admin");
      await logActivity(newJob.id, "job", "Created", `Created from lead: ${lead.name}`, profile?.full_name || "Admin");
      setLeads(leads.map(l => l.id === lead.id ? { ...l, stage: "Sold" } : l));
      setSelected(null);
      alert(`✅ Converted! "${newJob.title}" created with ${DEFAULT_TASKS.length} production tasks.`);
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
  };

  const deleteLead = async (id) => {
    if (!confirm("Delete this lead?")) return;
    setLeads(leads.filter(l => l.id !== id));
    try { await db.delete("leads", id); } catch (e) { Sentry.captureException(e); load(); }
  };

  // Follow-up alerts
  const overdueFollowUps = leads.filter(l => l.follow_up_date && new Date(l.follow_up_date) < new Date() && l.stage !== "Lost" && l.stage !== "Sold");

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div><h2 className="text-2xl font-bold text-gray-900">Pipeline</h2><p className="text-sm text-gray-500 mt-0.5">{leads.length} leads</p></div>
        <button onClick={() => setShowModal(true)} className={btnSm}>+ Add Lead</button>
      </div>

      {/* Overdue follow-up alerts */}
      {overdueFollowUps.length > 0 && (
        <div className="bg-orange-50 border border-orange-100 rounded-2xl p-3 mb-4">
          <p className="text-sm font-semibold text-orange-800">🔔 {overdueFollowUps.length} overdue follow-up{overdueFollowUps.length > 1 ? "s" : ""}</p>
          {overdueFollowUps.map(l => (
            <button key={l.id} onClick={() => setSelected(l)} className="text-xs text-orange-600 hover:underline block mt-1">{l.name} — due {new Date(l.follow_up_date).toLocaleDateString()}</button>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white shadow-sm" />
        <button onClick={() => setView(view === "list" ? "board" : "list")}
          className="border border-gray-200 bg-white rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:border-gray-400">
          {view === "list" ? "📋 Board" : "☰ List"}
        </button>
      </div>

      {loading ? <Spinner /> : view === "board" ? (
        <KanbanBoard leads={filtered} onSelectLead={setSelected} onStageChange={handleStageChange} teamMembers={teamMembers} profile={profile} />
      ) : (
        <div className="grid gap-3">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No leads yet</p>}
          {filtered.map(lead => (
            <div key={lead.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-white font-bold flex-shrink-0">{lead.name?.[0] || "?"}</div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelected(lead)}>
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-gray-900">{lead.name}</span><Badge label={lead.stage || "Lead"} /></div>
                  <p className="text-sm text-gray-500 mt-0.5">{lead.email}{lead.phone ? ` · ${lead.phone}` : ""}</p>
                  {lead.inspection_date && <p className="text-xs text-gray-400 mt-0.5">🔍 {new Date(lead.inspection_date).toLocaleDateString()}</p>}
                  {lead.follow_up_date && <p className={`text-xs mt-0.5 ${new Date(lead.follow_up_date) < new Date() ? "text-orange-500 font-medium" : "text-gray-400"}`}>🔔 {new Date(lead.follow_up_date).toLocaleDateString()}</p>}
                  {lead.proposal_amount && <p className="text-xs font-semibold text-gray-700 mt-0.5">💰 ${Number(lead.proposal_amount).toLocaleString()}</p>}
                  {lead.assigned_name && <p className="text-xs mt-1 text-gray-600 font-medium">👤 {lead.assigned_name}</p>}
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                  {isAdmin && (
                    <select value={lead.assigned_to || ""} onChange={async e => {
                      const member = teamMembers.find(m => m.id === e.target.value);
                      const update = { assigned_to: e.target.value || null, assigned_name: member?.full_name || member?.email || null };
                      setLeads(leads.map(l => l.id === lead.id ? { ...l, ...update } : l));
                      try { await db.update("leads", lead.id, update); } catch (err) { Sentry.captureException(err); }
                    }} className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-gray-50 text-gray-700 focus:outline-none max-w-[130px]">
                      <option value="">Unassigned</option>
                      {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setSelected(lead)} className="text-xs text-gray-500 hover:text-gray-800">View</button>
                    {isAdmin && <button onClick={() => deleteLead(lead.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title="Add New Lead" onClose={() => setShowModal(false)}>
          <Field label="Full Name *" value={form.name} onChange={v => setForm({ ...form, name: v })} />
          <Field label="Phone" value={form.phone} onChange={v => setForm({ ...form, phone: v })} />
          <Field label="Email" value={form.email} onChange={v => setForm({ ...form, email: v })} />
          <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} />
          <Field label="Source" value={form.source} onChange={v => setForm({ ...form, source: v })} options={["Referral", "Website", "Door Knock", "Social Media", "Other"]} />
          <Field label="Stage" value={form.stage} onChange={v => setForm({ ...form, stage: v })} options={LEAD_STAGES} />
          {isAdmin && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
              <select value={form.assigned_to} onChange={e => {
                const member = teamMembers.find(m => m.id === e.target.value);
                setForm({ ...form, assigned_to: e.target.value, assigned_name: member?.full_name || member?.email || "" });
              }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white">
                <option value="">Unassigned</option>
                {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
            </div>
          )}
          <Field label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} type="textarea" />
          <button onClick={addLead} disabled={saving} className={`w-full ${btnPrimary}`}>{saving ? "Saving..." : "Save Lead"}</button>
        </Modal>
      )}

      {selected && (
        <LeadDetailModal lead={selected} db={db} token={token} teamMembers={teamMembers} profile={profile}
          onClose={() => setSelected(null)}
          onUpdate={updated => { setLeads(leads.map(l => l.id === updated.id ? updated : l)); setSelected(updated); }}
          onConvert={handleConvert} />
      )}
    </div>
  );
}

// ─── JOBS ─────────────────────────────────────────────────────────────────────
function JobsView({ db, token, profile }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("All");
  const [form, setForm] = useState({ title: "", customer: "", address: "", stage: "In Production", type: "Roofing", start_date: "", value: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setJobs(await db.list("jobs")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = filter === "All" ? jobs : jobs.filter(j => (j.stage || "In Production") === filter);
  const typeIcon = { Roofing: "🏠", Remodeling: "🔨", Siding: "🪵", Windows: "🪟", Other: "🔧" };

  const addJob = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      const [created] = await db.insert("jobs", { ...form, value: parseFloat(form.value) || 0, status: "In Progress" });
      await logActivity(created.id, "job", "Created", `Job created: ${form.title}`, profile?.full_name || "Admin");
      setJobs([created, ...jobs]);
      setForm({ title: "", customer: "", address: "", stage: "In Production", type: "Roofing", start_date: "", value: "", notes: "" });
      setShowModal(false);
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const deleteJob = async (id) => {
    if (!confirm("Delete this job?")) return;
    setJobs(jobs.filter(j => j.id !== id));
    try { await db.delete("jobs", id); } catch (e) { Sentry.captureException(e); load(); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Jobs & Projects</h2><p className="text-sm text-gray-500 mt-0.5">{jobs.length} total</p></div>
        <button onClick={() => setShowModal(true)} className={btnSm}>+ New Job</button>
      </div>
      <div className="flex gap-2 mb-5 flex-wrap">
        {["All", ...JOB_STAGES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === s ? "bg-gray-800 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}>{s}</button>
        ))}
      </div>
      {loading ? <Spinner /> : (
        <div className="grid gap-3">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No jobs yet</p>}
          {filtered.map(job => (
            <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{typeIcon[job.type] || "🔧"}</span>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelected(job)}>
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-gray-900">{job.title}</span><Badge label={job.stage || "In Production"} /></div>
                  <p className="text-sm text-gray-500 mt-0.5">{job.customer}{job.address ? ` · ${job.address}` : ""}</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">${Number(job.value || 0).toLocaleString()}</p>
                  {job.crew && <p className="text-xs text-gray-400 mt-0.5">👷 {job.crew}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setSelected(job)} className="text-xs text-gray-500 hover:text-gray-800">View</button>
                  <button onClick={() => deleteJob(job.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <Modal title="Add New Job" onClose={() => setShowModal(false)}>
          <Field label="Job Title *" value={form.title} onChange={v => setForm({ ...form, title: v })} />
          <Field label="Customer Name" value={form.customer} onChange={v => setForm({ ...form, customer: v })} />
          <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} />
          <Field label="Job Type" value={form.type} onChange={v => setForm({ ...form, type: v })} options={["Roofing", "Remodeling", "Siding", "Windows", "Other"]} />
          <Field label="Stage" value={form.stage} onChange={v => setForm({ ...form, stage: v })} options={JOB_STAGES} />
          <Field label="Start Date" value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} type="date" />
          <Field label="Contract Value ($)" value={form.value} onChange={v => setForm({ ...form, value: v })} type="number" />
          <Field label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} type="textarea" />
          <button onClick={addJob} disabled={saving} className={`w-full ${btnPrimary}`}>{saving ? "Saving..." : "Save Job"}</button>
        </Modal>
      )}
      {selected && (
        <JobDetailModal job={selected} db={db} token={token} profile={profile}
          onClose={() => setSelected(null)}
          onUpdate={updated => { setJobs(jobs.map(j => j.id === updated.id ? updated : j)); setSelected(updated); }} />
      )}
    </div>
  );
}

// ─── ESTIMATES ────────────────────────────────────────────────────────────────
const EST_STATUSES = ["Draft", "Sent", "Approved", "Declined"];

function ESignatureModal({ estimate, db, onClose, onSigned }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e) => { e.preventDefault(); const canvas = canvasRef.current; const ctx = canvas.getContext("2d"); const pos = getPos(e, canvas); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); setDrawing(true); setHasSignature(true); };
  const draw = (e) => { e.preventDefault(); if (!drawing) return; const canvas = canvasRef.current; const ctx = canvas.getContext("2d"); const pos = getPos(e, canvas); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#1C1F22"; ctx.lineTo(pos.x, pos.y); ctx.stroke(); };
  const endDraw = () => setDrawing(false);
  const clear = () => { const canvas = canvasRef.current; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); setHasSignature(false); };

  const save = async () => {
    if (!hasSignature || !name) { alert("Please sign and enter your name"); return; }
    setSaving(true);
    try {
      const signatureData = canvasRef.current.toDataURL("image/png");
      await db.insert("signatures", { estimate_id: estimate.id, customer_name: name, signature_data: signatureData });
      await db.update("estimates", estimate.id, { status: "Approved", signature_url: signatureData });
      onSigned(); onClose();
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-base font-bold text-gray-900">✍️ Sign Estimate</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5">
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-gray-800">{estimate.number} — {estimate.customer}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">${Number(estimate.amount || 0).toLocaleString()}</p>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Type your full name..."
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
          </div>
          <div className="mb-4">
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Signature *</label>
              <button onClick={clear} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear</button>
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-gray-50 relative">
              <canvas ref={canvasRef} width={460} height={160} className="w-full touch-none cursor-crosshair"
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
              {!hasSignature && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><p className="text-gray-300 text-sm">Sign here with your finger or mouse</p></div>}
            </div>
          </div>
          <button onClick={save} disabled={saving || !hasSignature || !name} className={`w-full ${btnPrimary}`}>
            {saving ? "Saving..." : "✍️ Sign & Approve Estimate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EstimatesView({ db }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("Estimates");
  const [signing, setSigning] = useState(null);
  const [form, setForm] = useState({ number: "", customer: "", job: "", date: "", amount: "", status: "Draft", type: "Estimate" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await db.list("estimates")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = tab === "Estimates" ? items.filter(i => i.type !== "Invoice") : items.filter(i => i.type === "Invoice");
  const totalApproved = items.filter(i => i.status === "Approved").reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalPaid = items.filter(i => i.status === "Paid").reduce((s, i) => s + Number(i.amount || 0), 0);

  const addItem = async () => {
    if (!form.number) return;
    setSaving(true);
    try {
      const [created] = await db.insert("estimates", { ...form, amount: parseFloat(form.amount) || 0 });
      setItems([created, ...items]);
      setForm({ number: "", customer: "", job: "", date: "", amount: "", status: "Draft", type: form.type });
      setShowModal(false);
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const deleteItem = async (id) => {
    if (!confirm("Delete?")) return;
    setItems(items.filter(i => i.id !== id));
    try { await db.delete("estimates", id); } catch (e) { Sentry.captureException(e); load(); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Estimates & Invoices</h2><p className="text-sm text-gray-500 mt-0.5">{items.length} documents</p></div>
        <button onClick={() => setShowModal(true)} className={btnSm}>+ New</button>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-gray-800 rounded-2xl p-4"><p className="text-xs text-gray-400 font-medium uppercase">Approved</p><p className="text-2xl font-bold text-white mt-1">${totalApproved.toLocaleString()}</p></div>
        <div className="bg-gray-600 rounded-2xl p-4"><p className="text-xs text-gray-300 font-medium uppercase">Paid</p><p className="text-2xl font-bold text-white mt-1">${totalPaid.toLocaleString()}</p></div>
      </div>
      <div className="flex gap-2 mb-5">
        {["Estimates", "Invoices"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? "bg-gray-800 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>{t}</button>
        ))}
      </div>
      {loading ? <Spinner /> : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Number</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-gray-700 font-medium">{item.number}</td>
                  <td className="px-4 py-3 text-gray-700">{item.customer}</td>
                  <td className="px-4 py-3 text-right font-semibold">${Number(item.amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-center"><Badge label={item.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-center">
                      {item.type !== "Invoice" && item.status !== "Approved" && (
                        <button onClick={() => setSigning(item)} className="text-xs bg-gray-800 text-white px-2 py-1 rounded-lg hover:bg-gray-700">✍️</button>
                      )}
                      {item.signature_url && <span title="Signed">✅</span>}
                      <button onClick={() => deleteItem(item.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-gray-400">No {tab.toLowerCase()} yet</div>}
        </div>
      )}
      {showModal && (
        <Modal title={`New ${form.type}`} onClose={() => setShowModal(false)}>
          <Field label="Type" value={form.type} onChange={v => setForm({ ...form, type: v })} options={["Estimate", "Invoice"]} />
          <Field label="Number *" value={form.number} onChange={v => setForm({ ...form, number: v })} />
          <Field label="Customer" value={form.customer} onChange={v => setForm({ ...form, customer: v })} />
          <Field label="Related Job" value={form.job} onChange={v => setForm({ ...form, job: v })} />
          <Field label="Date" value={form.date} onChange={v => setForm({ ...form, date: v })} type="date" />
          <Field label="Amount ($)" value={form.amount} onChange={v => setForm({ ...form, amount: v })} type="number" />
          <Field label="Status" value={form.status} onChange={v => setForm({ ...form, status: v })} options={form.type === "Invoice" ? ["Draft", "Sent", "Paid"] : EST_STATUSES} />
          <button onClick={addItem} disabled={saving} className={`w-full ${btnPrimary}`}>{saving ? "Saving..." : `Save ${form.type}`}</button>
        </Modal>
      )}
      {signing && (
        <ESignatureModal estimate={signing} db={db}
          onClose={() => setSigning(null)}
          onSigned={() => { setItems(items.map(i => i.id === signing.id ? { ...i, status: "Approved" } : i)); setSigning(null); }} />
      )}
    </div>
  );
}

// ─── TASKS ────────────────────────────────────────────────────────────────────
const TASK_PRIORITIES = ["Low", "Medium", "High"];
function TasksView({ db }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("Pending");
  const [form, setForm] = useState({ title: "", due: "", priority: "Medium", assigned: "", related: "", status: "Pending" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setTasks(await db.list("tasks")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = tasks.filter(t => t.status === filter);
  const pendingCount = tasks.filter(t => t.status === "Pending").length;
  const doneCount = tasks.filter(t => t.status === "Done").length;

  const addTask = async () => {
    if (!form.title) return;
    setSaving(true);
    try { const [created] = await db.insert("tasks", form); setTasks([created, ...tasks]); setForm({ title: "", due: "", priority: "Medium", assigned: "", related: "", status: "Pending" }); setShowModal(false); }
    catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const toggleDone = async (task) => {
    const newStatus = task.status === "Done" ? "Pending" : "Done";
    setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    try { await db.update("tasks", task.id, { status: newStatus }); } catch (e) { Sentry.captureException(e); load(); }
  };

  const deleteTask = async (id) => {
    if (!confirm("Delete?")) return;
    setTasks(tasks.filter(t => t.id !== id));
    try { await db.delete("tasks", id); } catch (e) { Sentry.captureException(e); load(); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Tasks</h2><p className="text-sm text-gray-500 mt-0.5">{pendingCount} pending · {doneCount} done</p></div>
        <button onClick={() => setShowModal(true)} className={btnSm}>+ Add Task</button>
      </div>
      <div className="flex gap-2 mb-5">
        {["Pending", "Done"].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === s ? "bg-gray-800 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
            {s} ({s === "Pending" ? pendingCount : doneCount})
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : (
        <div className="grid gap-3">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No {filter.toLowerCase()} tasks</p>}
          {filtered.map(task => (
            <div key={task.id} className={`bg-white rounded-2xl border shadow-sm p-4 flex items-start gap-3 ${task.status === "Done" ? "opacity-60" : ""} border-gray-100`}>
              <button onClick={() => toggleDone(task)}
                className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${task.status === "Done" ? "bg-gray-800 border-gray-800" : "border-gray-300 hover:border-gray-600"}`}>
                {task.status === "Done" && <span className="text-white text-xs">✓</span>}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium text-gray-900 ${task.status === "Done" ? "line-through text-gray-400" : ""}`}>{task.title}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusColors[task.priority]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${priorityDot[task.priority]}`}></span>{task.priority}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                  {task.due && <span>📅 {task.due}</span>}
                  {task.assigned && <span>👤 {task.assigned}</span>}
                  {task.related && <span>🔗 {task.related}</span>}
                </div>
              </div>
              <button onClick={() => deleteTask(task.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <Modal title="Add New Task" onClose={() => setShowModal(false)}>
          <Field label="Task Title *" value={form.title} onChange={v => setForm({ ...form, title: v })} />
          <Field label="Due Date" value={form.due} onChange={v => setForm({ ...form, due: v })} type="date" />
          <Field label="Priority" value={form.priority} onChange={v => setForm({ ...form, priority: v })} options={TASK_PRIORITIES} />
          <Field label="Assigned To" value={form.assigned} onChange={v => setForm({ ...form, assigned: v })} />
          <Field label="Related Job / Lead" value={form.related} onChange={v => setForm({ ...form, related: v })} />
          <button onClick={addTask} disabled={saving} className={`w-full ${btnPrimary}`}>{saving ? "Saving..." : "Save Task"}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ db, setTab }) {
  const [stats, setStats] = useState({ leads: 0, jobs: 0, pipeline: 0, tasks: 0 });
  const [recentJobs, setRecentJobs] = useState([]);
  const [upcomingTasks, setUpcomingTasks] = useState([]);
  const [stageBreakdown, setStageBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [leads, jobs, tasks] = await Promise.all([db.list("leads"), db.list("jobs"), db.list("tasks")]);
        const pipeline = leads.filter(l => l.proposal_amount).reduce((s, l) => s + Number(l.proposal_amount || 0), 0);
        setStats({ leads: leads.length, jobs: jobs.length, pipeline, tasks: tasks.filter(t => t.status === "Pending").length });
        setRecentJobs(jobs.slice(0, 3));
        setUpcomingTasks(tasks.filter(t => t.status === "Pending").slice(0, 4));
        setStageBreakdown(LEAD_STAGES.map(s => ({ stage: s, count: leads.filter(l => (l.stage || "Lead") === s).length })));
      } catch (e) { Sentry.captureException(e); }
      finally { setLoading(false); }
    }
    load();
  }, [db]);

  const cards = [
    { label: "Active Leads", value: stats.leads, icon: "👥", color: "bg-gray-800", text: "text-white", sub: "text-gray-400", tab: "leads" },
    { label: "Open Jobs", value: stats.jobs, icon: "🏗️", color: "bg-gray-700", text: "text-white", sub: "text-gray-400", tab: "jobs" },
    { label: "Proposal Pipeline", value: `$${stats.pipeline.toLocaleString()}`, icon: "💰", color: "bg-gray-600", text: "text-white", sub: "text-gray-300", tab: "leads" },
    { label: "Tasks Due", value: stats.tasks, icon: "✅", color: "bg-gray-500", text: "text-white", sub: "text-gray-200", tab: "tasks" },
  ];

  return (
    <div>
      <div className="mb-6"><h2 className="text-2xl font-bold text-gray-900">Dashboard</h2><p className="text-sm text-gray-500 mt-0.5">Your live business overview</p></div>
      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {cards.map(s => (
              <button key={s.label} onClick={() => setTab(s.tab)} className={`${s.color} rounded-2xl p-4 text-left hover:opacity-90 transition-all`}>
                <div className="text-2xl mb-2">{s.icon}</div>
                <p className={`text-2xl font-bold ${s.text}`}>{s.value}</p>
                <p className={`text-xs mt-0.5 font-medium ${s.sub}`}>{s.label}</p>
              </button>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <h3 className="font-bold text-gray-900 mb-4">Pipeline Breakdown</h3>
            <div className="space-y-2">
              {stageBreakdown.map(({ stage, count }) => (
                <div key={stage} className="flex items-center gap-3">
                  <span className="text-sm w-6">{stageIcon[stage]}</span>
                  <span className="text-sm text-gray-600 w-32">{stage}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className="bg-gray-800 h-2 rounded-full" style={{ width: `${stats.leads ? (count / stats.leads) * 100 : 0}%` }} />
                  </div>
                  <span className="text-sm font-bold text-gray-700 w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <h3 className="font-bold text-gray-900 mb-3">Recent Jobs</h3>
            {recentJobs.length === 0 ? <p className="text-sm text-gray-400">No jobs yet</p> : (
              <div className="space-y-3">
                {recentJobs.map(job => (
                  <div key={job.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{job.title}</p><p className="text-xs text-gray-400">{job.customer}</p></div>
                    <div className="flex items-center gap-2"><span className="text-sm font-semibold text-gray-700">${Number(job.value || 0).toLocaleString()}</span><Badge label={job.stage || "In Production"} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-gray-900 mb-3">Pending Tasks</h3>
            {upcomingTasks.length === 0 ? <p className="text-sm text-gray-400">No pending tasks</p> : (
              <div className="space-y-2">
                {upcomingTasks.map(task => (
                  <div key={task.id} className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot[task.priority]}`}></span>
                    <p className="text-sm text-gray-700 flex-1 truncate">{task.title}</p>
                    {task.due && <span className="text-xs text-gray-400">{task.due}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── RECOMMENDATIONS ──────────────────────────────────────────────────────────
const REC_CATEGORIES = ["Feature Request", "Bug Report", "Process Improvement", "UI Feedback", "Other"];
const REC_STATUSES = ["Pending", "Under Review", "Implemented", "Dismissed"];

function RecommendationsView({ db, profile }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [filter, setFilter] = useState("All");
  const isAdmin = profile?.role === "admin";
  const [form, setForm] = useState({ title: "", category: "Feature Request", message: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRecs(await db.list("recommendations")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = filter === "All" ? recs : recs.filter(r => r.status === filter);

  const submit = async () => {
    if (!form.title || !form.message) return;
    setSaving(true);
    try {
      const payload = { ...form, status: "Pending", submitted_by: profile?.full_name || profile?.email || "Team Member" };
      await db.insert("recommendations", payload);
      await sendRecommendationEmail(payload.submitted_by, form.category, `${form.title}\n\n${form.message}`);
      setForm({ title: "", category: "Feature Request", message: "" });
      setShowModal(false); setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4000); load();
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const updateStatus = async (id, status) => {
    setRecs(recs.map(r => r.id === id ? { ...r, status } : r));
    try { await db.update("recommendations", id, { status }); } catch (e) { Sentry.captureException(e); load(); }
  };

  const catIcon = { "Feature Request": "💡", "Bug Report": "🐛", "Process Improvement": "⚙️", "UI Feedback": "🎨", "Other": "📝" };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Recommendations</h2><p className="text-sm text-gray-500 mt-0.5">Share ideas or report issues</p></div>
        <button onClick={() => setShowModal(true)} className={btnSm}>+ Submit</button>
      </div>
      {submitted && <div className="bg-green-50 border border-green-100 rounded-2xl p-4 mb-4 flex items-center gap-3"><span className="text-2xl">✅</span><div><p className="text-sm font-semibold text-green-800">Submitted!</p><p className="text-xs text-green-600">Ian has been notified.</p></div></div>}
      {isAdmin && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {["All", ...REC_STATUSES].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === s ? "bg-gray-800 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>{s}</button>
          ))}
        </div>
      )}
      {loading ? <Spinner /> : (
        <div className="grid gap-3">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No recommendations yet</p>}
          {filtered.map(rec => (
            <div key={rec.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{catIcon[rec.category] || "📝"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1"><span className="font-semibold text-gray-900">{rec.title}</span><Badge label={rec.status} /><span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{rec.category}</span></div>
                  <p className="text-sm text-gray-600 mt-1">{rec.message}</p>
                  <p className="text-xs text-gray-400 mt-2">By {rec.submitted_by} · {new Date(rec.created_at).toLocaleDateString()}</p>
                </div>
                {isAdmin && <select value={rec.status} onChange={e => updateStatus(rec.id, e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none flex-shrink-0">{REC_STATUSES.map(s => <option key={s}>{s}</option>)}</select>}
              </div>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <Modal title="Submit a Recommendation" onClose={() => setShowModal(false)}>
          <Field label="Title *" value={form.title} onChange={v => setForm({ ...form, title: v })} />
          <Field label="Category" value={form.category} onChange={v => setForm({ ...form, category: v })} options={REC_CATEGORIES} />
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Details *</label>
            <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={5} placeholder="Describe your idea or issue..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none" />
          </div>
          <button onClick={submit} disabled={saving || !form.title || !form.message} className={`w-full ${btnPrimary}`}>{saving ? "Submitting..." : "Submit Recommendation"}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── ACCESS REQUESTS ──────────────────────────────────────────────────────────
function generatePassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function AccessRequests({ onBadgeUpdate }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/access_requests?select=*&order=created_at.desc`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });
      const data = await res.json();
      setRequests(data);
      onBadgeUpdate && onBadgeUpdate(data.filter(r => r.status === "Pending").length);
    } catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (req) => {
    setApproving(req.id);
    try {
      const password = generatePassword();
      // Use database function to create user securely
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_user_account`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_email: req.email, user_password: password, user_full_name: req.full_name }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to create user");
      }
      // Update request status
      await fetch(`${SUPABASE_URL}/rest/v1/access_requests?id=eq.${req.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Approved", auto_password: password }),
      });
      // Email admin with credentials
      await sendEmail(`🔑 New Account Created for ${req.full_name}`,
        `<div style="font-family:sans-serif;padding:24px;"><h2>✅ Account Created</h2><p>Share these credentials with <strong>${req.full_name}</strong>:</p><p><b>URL:</b> build-com-topaz.vercel.app</p><p><b>Email:</b> ${req.email}</p><p><b>Password:</b> <span style="font-size:20px;font-weight:bold;letter-spacing:3px;">${password}</span></p></div>`);
      setRequests(requests.map(r => r.id === req.id ? { ...r, status: "Approved", auto_password: password } : r));
      onBadgeUpdate && onBadgeUpdate(requests.filter(r => r.status === "Pending" && r.id !== req.id).length);
      alert("Account created for " + req.full_name + "! Password: " + password + ". Send via text!");
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setApproving(null); }
  };

  const deny = async (req) => {
    if (!confirm(`Deny access for ${req.full_name}?`)) return;
    await fetch(`${SUPABASE_URL}/rest/v1/access_requests?id=eq.${req.id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Denied" }),
    });
    setRequests(requests.map(r => r.id === req.id ? { ...r, status: "Denied" } : r));
    onBadgeUpdate && onBadgeUpdate(requests.filter(r => r.status === "Pending" && r.id !== req.id).length);
  };

  const pending = requests.filter(r => r.status === "Pending");
  return (
    <div className="mt-8">
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">🔑 Access Requests {pending.length > 0 && <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{pending.length}</span>}</h3>
      {loading ? <Spinner /> : requests.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">No access requests yet</p> : (
        <div className="grid gap-3">
          {requests.map(req => (
            <div key={req.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${req.status === "Pending" ? "border-gray-300" : "border-gray-100 opacity-70"}`}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-white font-bold flex-shrink-0">{req.full_name?.[0] || "?"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-gray-900">{req.full_name}</span><Badge label={req.status} /></div>
                  <p className="text-sm text-gray-500 mt-0.5">{req.email}</p>
                  <p className="text-sm text-gray-600 mt-1 italic">"{req.reason}"</p>
                  {req.status === "Approved" && req.auto_password && <p className="text-xs text-green-600 mt-1 font-medium">✅ Account created · Credentials emailed to you</p>}
                </div>
                {req.status === "Pending" && (
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button onClick={() => approve(req)} disabled={approving === req.id} className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-50">{approving === req.id ? "Creating..." : "Approve"}</button>
                    <button onClick={() => deny(req)} className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-100">Deny</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function AdminPanel({ db, currentUser, onBadgeUpdate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteName, setInviteName] = useState("");
  const [saving, setSaving] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [pendingRequests, setPendingRequests] = useState(0);

  useEffect(() => { onBadgeUpdate && onBadgeUpdate(pendingRequests); }, [pendingRequests]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await db.list("profiles", "select=*&order=created_at.desc")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const updateRole = async (id, role) => {
    setUsers(users.map(u => u.id === id ? { ...u, role } : u));
    try { await db.update("profiles", id, { role }); } catch (e) { Sentry.captureException(e); load(); }
  };

  const createUser = async () => {
    if (!inviteEmail || !invitePassword) return;
    setSaving(true); setInviteMsg("");
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, password: invitePassword, email_confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.msg || "Failed to create user");
      await db.update("profiles", data.id, { role: inviteRole, full_name: inviteName });
      setInviteMsg("✅ User created!");
      setInviteEmail(""); setInvitePassword(""); setInviteName(""); setInviteRole("member");
      load();
    } catch (e) { Sentry.captureException(e); setInviteMsg("⚠️ " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Admin Panel</h2><p className="text-sm text-gray-500 mt-0.5">Manage your team</p></div>
        <button onClick={() => setShowInvite(true)} className={btnSm}>+ Add User</button>
      </div>
      <div className="bg-gray-800 rounded-2xl p-4 mb-5">
        <p className="text-sm text-white font-medium">👑 Admin Controls</p>
        <p className="text-xs text-gray-400 mt-0.5">You see all leads. Members only see leads assigned to them.</p>
      </div>
      {loading ? <Spinner /> : (
        <div className="grid gap-3">
          {users.map(user => (
            <div key={user.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-white font-bold flex-shrink-0">{(user.full_name || user.email || "?")[0].toUpperCase()}</div>
              <div className="flex-1 min-w-0"><p className="font-semibold text-gray-900 truncate">{user.full_name || "—"}</p><p className="text-xs text-gray-400 truncate">{user.email}</p></div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {user.id === currentUser.id ? <Badge label={user.role} /> : (
                  <select value={user.role} onChange={e => updateRole(user.id, e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none">
                    <option value="member">member</option><option value="admin">admin</option>
                  </select>
                )}
                {user.id === currentUser.id && <span className="text-xs text-gray-400">(you)</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <AccessRequests onBadgeUpdate={setPendingRequests} />
      {showInvite && (
        <Modal title="Add New User" onClose={() => { setShowInvite(false); setInviteMsg(""); }}>
          {inviteMsg && <div className={`rounded-xl px-4 py-3 mb-4 text-sm ${inviteMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{inviteMsg}</div>}
          <Field label="Full Name" value={inviteName} onChange={setInviteName} />
          <Field label="Email *" value={inviteEmail} onChange={setInviteEmail} type="email" />
          <Field label="Password *" value={invitePassword} onChange={setInvitePassword} type="password" />
          <Field label="Role" value={inviteRole} onChange={setInviteRole} options={["member", "admin"]} />
          <button onClick={createUser} disabled={saving} className={`w-full ${btnPrimary}`}>{saving ? "Creating..." : "Create User"}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
function ChangePasswordModal({ token, onClose }) {
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async () => {
    if (!current || !newPass || !confirm) { setMsg("⚠️ Please fill in all fields"); return; }
    if (newPass !== confirm) { setMsg("⚠️ New passwords don't match"); return; }
    if (newPass.length < 6) { setMsg("⚠️ Password must be at least 6 characters"); return; }
    setSaving(true); setMsg("");
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.msg || data.message || "Failed to update password");
      setMsg("✅ Password updated successfully!");
      setTimeout(() => onClose(), 1500);
    } catch (e) { Sentry.captureException(e); setMsg("⚠️ " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-base font-bold text-gray-900">🔒 Change Password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5">
          {msg && <div className={`rounded-xl px-4 py-3 mb-4 text-sm ${msg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{msg}</div>}
          <div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="password" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" /></div>
          <div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="password" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" /></div>
          <div className="mb-6"><label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="password" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" onKeyDown={e => e.key === "Enter" && save()} /></div>
          <button onClick={save} disabled={saving} className={`w-full ${btnPrimary}`}>{saving ? "Updating..." : "Update Password"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function RequestAccessScreen({ onBack }) {
  const [form, setForm] = useState({ full_name: "", email: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!form.full_name || !form.email || !form.reason) { setError("Please fill in all fields"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/access_requests`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to submit");
      await sendAccessRequestEmail(form.full_name, form.email, form.reason);
      setDone(true);
    } catch (e) { Sentry.captureException(e); setError(e.message); }
    finally { setSaving(false); }
  };

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">✅</span></div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Request Submitted!</h2>
        <p className="text-gray-500 text-sm mb-6">Ian will review your request and contact you at <strong>{form.email}</strong>.</p>
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 underline">Back to Sign In</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6"><TetrahedronLogin /></div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Request Access</h1>
        <p className="text-gray-500 text-sm mb-6">Fill in your details and we'll review your request.</p>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">⚠️ {error}</div>}
          <div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="John Smith" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" /></div>
          <div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" /></div>
          <div className="mb-6"><label className="block text-sm font-medium text-gray-700 mb-1">Why do you need access? *</label>
            <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={3} placeholder="I'm a team member at..." className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none" /></div>
          <button onClick={submit} disabled={saving} className={`w-full ${btnPrimary} mb-3`}>{saving ? "Submitting..." : "Submit Request"}</button>
          <button onClick={onBack} className="w-full text-sm text-gray-400 hover:text-gray-600 py-2">← Back to Sign In</button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRequest, setShowRequest] = useState(false);

  if (showRequest) return <RequestAccessScreen onBack={() => setShowRequest(false)} />;

  const handleLogin = async () => {
    if (!email || !password) { setError("Please enter email and password"); return; }
    setLoading(true); setError("");
    try {
      const session = await signIn(email, password);
      const profile = await getProfile(session.user.id, session.access_token);
      onLogin({ session, profile });
    } catch (e) { Sentry.captureException(e); setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex" style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div className="hidden md:flex flex-col justify-between w-1/2 bg-gray-900 p-12">
        <TetrahedronLogin />
        <div><p className="text-gray-400 text-sm">"The simplest way to run your business."</p><p className="text-gray-600 text-xs mt-2">— Simplicity CRM</p></div>
      </div>
      <div className="flex-1 flex items-center justify-center px-6 bg-gray-50">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-8 md:hidden"><TetrahedronLogin /></div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h1>
          <p className="text-gray-500 text-sm mb-8">Sign in to your Simplicity account</p>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">⚠️ {error}</div>}
            <div className="mb-4"><label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" onKeyDown={e => e.key === "Enter" && handleLogin()} /></div>
            <div className="mb-6"><label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" onKeyDown={e => e.key === "Enter" && handleLogin()} /></div>
            <button onClick={handleLogin} disabled={loading} className={`w-full ${btnPrimary}`}>{loading ? "Signing in..." : "Sign In"}</button>
          </div>
          <p className="text-center text-sm text-gray-400 mt-4">Don't have access?{" "}<button onClick={() => setShowRequest(true)} className="text-gray-700 font-semibold hover:underline">Request Access</button></p>
        </div>
      </div>
    </div>
  );
}

// ─── AI ASSISTANT ────────────────────────────────────────────────────────────
function AIAssistant({ db, profile, leads, jobs, tasks }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I am your Simplicity AI assistant. I can help you manage leads, jobs, tasks, and more. Try asking:\n\n- What jobs are in production?\n- Add a lead for John Smith\n- What is my pipeline worth?\n- What tasks are due this week?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(function(prev) { return [...prev, { role: "user", content: userMsg }]; });
    setLoading(true);
    try {
      const ld = leads.slice(0, 15).map(function(l) { return { id: l.id, name: l.name, stage: l.stage, phone: l.phone, proposal_amount: l.proposal_amount }; });
      const jd = jobs.slice(0, 15).map(function(j) { return { id: j.id, title: j.title, customer: j.customer, stage: j.stage, value: j.value }; });
      const td = tasks.slice(0, 15).map(function(t) { return { id: t.id, title: t.title, status: t.status, due: t.due }; });
      const prompt = "You are an AI assistant for Simplicity CRM, a contractor business app. "
        + "Current leads: " + JSON.stringify(ld) + ". "
        + "Current jobs: " + JSON.stringify(jd) + ". "
        + "Current tasks: " + JSON.stringify(td) + ". "
        + "Answer the user question briefly and helpfully. "
        + "If they want to create a lead, reply with CREATELEADSTART then JSON then CREATELEADEND. "
        + "If they want to create a task, reply with CREATETASKSTART then JSON then CREATETASKEND. "
        + "User question: " + userMsg;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await response.json();
      const text = data.content && data.content[0] ? data.content[0].text : "Sorry, I could not process that.";
      let displayText = text;
      let actionResult = "";
      const leadMatch = text.match(/CREATELEADSTART([\s\S]*?)CREATELEADEND/);
      if (leadMatch) {
        try {
          const leadData = JSON.parse(leadMatch[1].trim());
          const created = await db.insert("leads", Object.assign({ stage: "Lead" }, leadData));
          actionResult = " Lead created for " + (created[0] ? created[0].name : "new contact") + "!";
          displayText = text.replace(/CREATELEADSTART[\s\S]*?CREATELEADEND/, "").trim();
        } catch(e) { actionResult = " Could not create lead automatically."; }
      }
      const taskMatch = text.match(/CREATETASKSTART([\s\S]*?)CREATETASKEND/);
      if (taskMatch) {
        try {
          const taskData = JSON.parse(taskMatch[1].trim());
          const created = await db.insert("tasks", Object.assign({ status: "Pending", priority: "Medium" }, taskData));
          actionResult = " Task created: " + (created[0] ? created[0].title : "new task") + "!";
          displayText = text.replace(/CREATETASKSTART[\s\S]*?CREATETASKEND/, "").trim();
        } catch(e) { actionResult = " Could not create task automatically."; }
      }
      setMessages(function(prev) { return [...prev, { role: "assistant", content: displayText + actionResult }]; });
    } catch(e) {
      Sentry.captureException(e);
      setMessages(function(prev) { return [...prev, { role: "assistant", content: "Sorry, I ran into an error. Please try again." }]; });
    } finally {
      setLoading(false);
    }
  };
