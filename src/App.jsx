import { useState, useEffect, useCallback, useRef } from "react";
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://16553aefa9b446bb357a046ad85f06f9@o4511527733755904.ingest.us.sentry.io/4511527740899328",
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
});

const SUPABASE_URL = "https://zbvxrwftgtiwtlqzgztv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpidnhyd2Z0Z3Rpd3RscXpnenR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NzU4NDgsImV4cCI6MjA5NjM1MTg0OH0.uuyQAAeJxtlf6FzjRMEUvdfTy5VD3j3mfy8G_lXx_ag";

const LEAD_STAGES = ["New Lead", "Inspection", "Estimate Sent", "Follow Up", "Sold", "Lost"];
const JOB_STAGES = ["Scheduled", "In Progress", "Punch List", "Invoiced", "Complete", "Cancelled"];
const JOB_TYPES = ["Roofing", "Siding", "Gutters", "Windows", "Remodeling", "Handyman", "Painting", "Flooring", "Plumbing", "Electrical", "Other"];
const LEAD_SOURCES = ["Referral", "Website", "Door Knock", "Google", "Facebook", "Yard Sign", "Repeat Customer", "Insurance", "Other"];
const DEFAULT_TASKS = ["Pull permit", "Order materials", "Assign crew", "Schedule start date", "Quality inspection", "Take completion photos", "Send invoice"];

const STAGE_COLORS = {
  "New Lead": "bg-blue-100 text-blue-800",
  "Inspection": "bg-purple-100 text-purple-800",
  "Estimate Sent": "bg-yellow-100 text-yellow-800",
  "Follow Up": "bg-orange-100 text-orange-800",
  "Sold": "bg-green-100 text-green-800",
  "Lost": "bg-red-100 text-red-800",
  "Scheduled": "bg-blue-100 text-blue-800",
  "In Progress": "bg-orange-100 text-orange-800",
  "Punch List": "bg-yellow-100 text-yellow-800",
  "Invoiced": "bg-purple-100 text-purple-800",
  "Complete": "bg-green-100 text-green-800",
  "Cancelled": "bg-red-100 text-red-800",
  "Pending": "bg-gray-100 text-gray-600",
  "Done": "bg-green-100 text-green-700",
  "High": "bg-red-100 text-red-700",
  "Medium": "bg-yellow-100 text-yellow-700",
  "Low": "bg-gray-100 text-gray-500",
  "Draft": "bg-gray-100 text-gray-600",
  "Sent": "bg-blue-100 text-blue-700",
  "Approved": "bg-green-100 text-green-700",
  "Declined": "bg-red-100 text-red-700",
  "Paid": "bg-emerald-100 text-emerald-700",
  "admin": "bg-gray-800 text-white",
  "member": "bg-gray-100 text-gray-600",
};

const STAGE_ICONS = {
  "New Lead": "👤", "Inspection": "🔍", "Estimate Sent": "📋",
  "Follow Up": "🔔", "Sold": "🤝", "Lost": "❌",
  "Scheduled": "📅", "In Progress": "🏗️", "Punch List": "📝",
  "Invoiced": "💰", "Complete": "✅", "Cancelled": "🚫",
};

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function signIn(email, password) {
  const r = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || d.msg || "Login failed");
  return d;
}
async function signOut(token) {
  await fetch(SUPABASE_URL + "/auth/v1/logout", {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + token },
  });
}
async function getProfile(userId, token) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + userId + "&select=*", {
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + token },
  });
  const d = await r.json();
  return d[0] || null;
}

function makeDb(token) {
  async function req(table, method, body, query) {
    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "",
    };
    const r = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?" + (query || ""), { method: method || "GET", headers, body: body ? JSON.stringify(body) : null });
    if (!r.ok) { const e = await r.text(); throw new Error(e); }
    if (method === "DELETE" || r.status === 204) return null;
    return r.json();
  }
  return {
    list: function(t, q) { return req(t, "GET", null, q || "select=*&order=created_at.desc"); },
    insert: function(t, d) { return req(t, "POST", d); },
    update: function(t, id, d) { return req(t, "PATCH", d, "id=eq." + id); },
    delete: function(t, id) { return req(t, "DELETE", null, "id=eq." + id); },
    query: function(t, q) { return req(t, "GET", null, q); },
  };
}

async function logActivity(db, relatedId, relatedType, action, detail, userName) {
  try {
    await fetch(SUPABASE_URL + "/rest/v1/activity_log", {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ related_id: relatedId, related_type: relatedType, action, detail, user_name: userName || "Team" }),
    });
  } catch (e) { console.error("Activity log error", e); }
}

async function uploadFile(token, file, relatedId, relatedType, db) {
  const ext = file.name.split(".").pop();
  const path = relatedType + "/" + relatedId + "/" + Date.now() + "." + ext;
  const r = await fetch(SUPABASE_URL + "/storage/v1/object/job-files/" + path, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + token, "Content-Type": file.type },
    body: file,
  });
  if (!r.ok) { const e = await r.text(); throw new Error(e); }
  const url = SUPABASE_URL + "/storage/v1/object/public/job-files/" + path;
  await db.insert("files", { name: file.name, url, type: file.type, related_id: relatedId, related_type: relatedType });
  return url;
}

async function sendEmail(subject, html) {
  try {
    await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, html }),
    });
  } catch (e) { Sentry.captureException(e); }
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Badge({ label }) {
  const cls = STAGE_COLORS[label] || "bg-gray-100 text-gray-600";
  return <span className={"inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold " + cls}>{label}</span>;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-700 rounded-full animate-spin"></div>
    </div>
  );
}

function Modal({ title, onClose, children, wide, noPad }) {
  useEffect(function() {
    const handler = function(e) { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return function() { window.removeEventListener("keydown", handler); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className={"bg-white w-full sm:rounded-2xl shadow-2xl " + (wide ? "sm:max-w-3xl" : "sm:max-w-lg") + " overflow-hidden max-h-[95vh] sm:max-h-[90vh] flex flex-col rounded-t-2xl"}
        onClick={function(e) { e.stopPropagation(); }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 text-xl leading-none transition-colors">&times;</button>
        </div>
        <div className={"overflow-y-auto flex-1 " + (noPad ? "" : "px-5 py-4")}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type, options, placeholder, required }) {
  const base = "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white";
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {options ? (
        <select value={value} onChange={function(e) { onChange(e.target.value); }} className={base}>
          {options.map(function(o) { return <option key={o}>{o}</option>; })}
        </select>
      ) : type === "textarea" ? (
        <textarea value={value} onChange={function(e) { onChange(e.target.value); }} rows={3} placeholder={placeholder || ""} className={base + " resize-none"} />
      ) : (
        <input type={type || "text"} value={value} onChange={function(e) { onChange(e.target.value); }} placeholder={placeholder || ""} className={base} />
      )}
    </div>
  );
}

const btnPrimary = "w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors";
const btnSm = "bg-gray-900 hover:bg-gray-800 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors flex-shrink-0";
const btnOutline = "border border-gray-200 hover:border-gray-400 bg-white text-gray-700 font-semibold px-4 py-2 rounded-xl text-sm transition-colors flex-shrink-0";

function mapsUrl(address) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}

function AddressLink({ address, className }) {
  if (!address) return null;
  return (
    <a href={mapsUrl(address)} target="_blank" rel="noreferrer"
      onClick={function(e) { e.stopPropagation(); }}
      className={(className || "") + " text-blue-600 hover:underline inline-flex items-center gap-1"}>
      📍 {address}
    </a>
  );
}

// ─── LOGO ─────────────────────────────────────────────────────────────────────
function Logo({ size }) {
  size = size || 32;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill="#111827"/>
      <g transform="translate(20,32)">
        <polygon points="0,-20 -15,-4 15,-4" fill="#4B5563"/>
        <polygon points="0,-20 -15,-4 0,-4" fill="#374151"/>
        <polygon points="0,-20 15,-4 0,-4" fill="#6B7280"/>
        <polygon points="0,20 -15,4 15,4" fill="#4B5563"/>
        <polygon points="0,20 -15,4 0,4" fill="#374151"/>
        <polygon points="0,20 15,4 0,4" fill="#6B7280"/>
        <polygon points="0,-4 -5,-2 -5,2 0,4 5,2 5,-2" fill="#E5E7EB"/>
        <circle cx="0" cy="0" r="2" fill="white"/>
      </g>
      <text x="39" y="27" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="700" fill="white" textAnchor="start">SIMP</text>
      <text x="39" y="40" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="700" fill="#6B7280" textAnchor="start">LICITY</text>
    </svg>
  );
}

function LogoLogin() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect width="80" height="80" rx="20" fill="#111827"/>
      <g transform="translate(28,40)">
        <polygon points="0,-26 -20,-5 20,-5" fill="#4B5563"/>
        <polygon points="0,-26 -20,-5 0,-5" fill="#374151"/>
        <polygon points="0,-26 20,-5 0,-5" fill="#6B7280"/>
        <polygon points="0,26 -20,5 20,5" fill="#4B5563"/>
        <polygon points="0,26 -20,5 0,5" fill="#374151"/>
        <polygon points="0,26 20,5 0,5" fill="#6B7280"/>
        <polygon points="0,-5 -7,-2.5 -7,2.5 0,5 7,2.5 7,-2.5" fill="#E5E7EB"/>
        <circle cx="0" cy="0" r="3" fill="white"/>
      </g>
    </svg>
  );
}

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────
function ActivityFeed({ relatedId, userName }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async function() {
    setLoading(true);
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1/activity_log?related_id=eq." + relatedId + "&order=created_at.desc&limit=30", {
        headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY },
      });
      setItems(await r.json());
    } catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [relatedId]);

  useEffect(function() { load(); }, [load]);

  const addNote = async function() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await fetch(SUPABASE_URL + "/rest/v1/activity_log", {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify({ related_id: relatedId, related_type: "record", action: "Note", detail: note, user_name: userName || "You" }),
      });
      setNote("");
      await load();
    } catch (e) { Sentry.captureException(e); }
    finally { setSaving(false); }
  };

  const icons = { "Note": "📝", "Stage Change": "🔄", "Created": "✨", "Converted": "🚀", "Photo": "📸", "Document": "📄", "Call": "📞", "Email": "✉️" };

  return (
    <div className="px-5 py-4">
      <div className="mb-5">
        <textarea
          value={note}
          onChange={function(e) { setNote(e.target.value); }}
          rows={3}
          placeholder="Log a call, note, or update..."
          style={{ fontSize: 16 }}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-gray-400 resize-none bg-white"
        />
        <button onClick={addNote} disabled={saving || !note.trim()} className={"mt-2 " + btnPrimary}>
          {saving ? "Saving..." : "📝 Log Note"}
        </button>
      </div>
      {loading ? <Spinner /> : (
        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No activity yet. Log a note to get started.</p>}
          {items.map(function(a) {
            return (
              <div key={a.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                  {icons[a.action] || "📌"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-800">{a.action}</span>
                    <span className="text-xs text-gray-400">{a.user_name}</span>
                    <span className="text-xs text-gray-300">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{a.detail}</p>
                </div>
              </div>
            );
          })}
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

  const load = useCallback(async function() {
    setLoading(true);
    try { setFiles(await db.list("files", "select=*&related_id=eq." + relatedId + "&order=created_at.desc")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db, relatedId]);

  useEffect(function() { load(); }, [load]);

  const handleUpload = async function(e) {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setUploading(true);
    try {
      for (var i = 0; i < selected.length; i++) {
        await uploadFile(token, selected[i], relatedId, relatedType, db);
      }
      await load();
    } catch (err) { Sentry.captureException(err); alert("Upload failed: " + err.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; if (cameraRef.current) cameraRef.current.value = ""; }
  };

  const deleteFile = async function(file) {
    if (!confirm("Delete this file?")) return;
    try { await db.delete("files", file.id); setFiles(files.filter(function(f) { return f.id !== file.id; })); }
    catch (e) { Sentry.captureException(e); }
  };

  const isImg = function(f) { return f.type && f.type.startsWith("image/"); };
  const photos = files.filter(isImg);
  const docs = files.filter(function(f) { return !isImg(f); });

  return (
    <div className="px-5 py-4">
      <div className="flex gap-2 mb-5 flex-wrap">
        <button onClick={function() { cameraRef.current.click(); }} disabled={uploading} className={btnSm}>
          {uploading ? "Uploading..." : "📷 Take Photo"}
        </button>
        <button onClick={function() { fileRef.current.click(); }} disabled={uploading} className={btnOutline}>
          📎 Upload File
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleUpload} />
        <input ref={fileRef} type="file" multiple className="hidden" onChange={handleUpload} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
      </div>

      {loading ? <Spinner /> : (
        <>
          {photos.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Photos ({photos.length})</p>
              <div className="grid grid-cols-3 gap-2">
                {photos.map(function(f) {
                  return (
                    <div key={f.id} className="relative group rounded-xl overflow-hidden aspect-square bg-gray-100">
                      <img src={f.url} alt={f.name} className="w-full h-full object-cover cursor-pointer" onClick={function() { setLightbox(f); }} />
                      <button onClick={function() { deleteFile(f); }} className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">X</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {docs.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Documents ({docs.length})</p>
              <div className="space-y-2">
                {docs.map(function(f) {
                  return (
                    <div key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                      <span className="text-xl">📄</span>
                      <p className="text-sm font-medium truncate flex-1">{f.name}</p>
                      <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-gray-800 px-3 py-1.5 border border-gray-200 rounded-lg">Open</a>
                      <button onClick={function() { deleteFile(f); }} className="text-xs text-red-400 hover:text-red-600 px-2">X</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {files.length === 0 && (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl">
              <p className="text-2xl mb-2">📁</p>
              <p className="text-gray-400 text-sm">No files yet</p>
              <p className="text-gray-300 text-xs mt-1">Take a photo or upload a document</p>
            </div>
          )}
        </>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4" onClick={function() { setLightbox(null); }}>
          <div className="relative max-w-4xl w-full" onClick={function(e) { e.stopPropagation(); }}>
            <img src={lightbox.url} alt={lightbox.name} className="w-full max-h-[85vh] object-contain rounded-xl" />
            <div className="flex items-center justify-between mt-3">
              <p className="text-white text-sm">{lightbox.name}</p>
              <button onClick={function() { setLightbox(null); }} className="bg-white/20 text-white px-4 py-2 rounded-xl text-sm">Close</button>
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

  const load = useCallback(async function() {
    setLoading(true);
    try { setTasks(await db.list("pipeline_tasks", "select=*&job_id=eq." + jobId + "&order=created_at.asc")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db, jobId]);

  useEffect(function() { load(); }, [load]);

  const addTask = async function(title) {
    if (!title.trim()) return;
    try {
      const created = await db.insert("pipeline_tasks", { job_id: jobId, title: title.trim(), status: "Pending" });
      setTasks(tasks.concat([created[0]]));
      setNewTask("");
    } catch (e) { Sentry.captureException(e); }
  };

  const toggle = async function(task) {
    const ns = task.status === "Done" ? "Pending" : "Done";
    setTasks(tasks.map(function(t) { return t.id === task.id ? Object.assign({}, t, { status: ns }) : t; }));
    try { await db.update("pipeline_tasks", task.id, { status: ns }); } catch (e) { load(); }
  };

  const remove = async function(id) {
    setTasks(tasks.filter(function(t) { return t.id !== id; }));
    try { await db.delete("pipeline_tasks", id); } catch (e) { load(); }
  };

  const done = tasks.filter(function(t) { return t.status === "Done"; }).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <div className="px-5 py-4">
      {tasks.length > 0 && (
        <div className="mb-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold text-gray-700">{done} of {tasks.length} complete</span>
            <span className="text-sm font-bold text-gray-900">{pct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="bg-gray-900 h-2 rounded-full transition-all" style={{ width: pct + "%" }} />
          </div>
        </div>
      )}
      <div className="space-y-2 mb-4">
        {loading ? <Spinner /> : tasks.map(function(task) {
          return (
            <div key={task.id} className={"flex items-center gap-3 p-3.5 rounded-xl border " + (task.status === "Done" ? "bg-gray-50 border-gray-100" : "bg-white border-gray-200")}>
              <button onClick={function() { toggle(task); }}
                className={"w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors " + (task.status === "Done" ? "bg-gray-900 border-gray-900" : "border-gray-300 hover:border-gray-600")}>
                {task.status === "Done" && <span className="text-white text-xs">✓</span>}
              </button>
              <span className={"flex-1 text-sm " + (task.status === "Done" ? "line-through text-gray-400" : "text-gray-800")}>{task.title}</span>
              <button onClick={function() { remove(task.id); }} className="text-gray-300 hover:text-red-400 text-sm px-1">X</button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mb-5">
        <input
          value={newTask}
          onChange={function(e) { setNewTask(e.target.value); }}
          onKeyDown={function(e) { if (e.key === "Enter") addTask(newTask); }}
          placeholder="Add a task..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
        <button onClick={function() { addTask(newTask); }} className={btnSm}>Add</button>
      </div>
      {tasks.length === 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Quick Add</p>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_TASKS.map(function(t) {
              return (
                <button key={t} onClick={function() { addTask(t); }}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-2 rounded-lg transition-colors">
                  + {t}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LEAD DETAIL ──────────────────────────────────────────────────────────────
function LeadDetail({ lead, db, token, profile, onClose, onUpdate, onConvert }) {
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState({
    stage: lead.stage || "New Lead",
    name: lead.name || "",
    phone: lead.phone || "",
    email: lead.email || "",
    address: lead.address || "",
    source: lead.source || "Referral",
    notes: lead.notes || "",
    proposal_amount: lead.proposal_amount || "",
    insurance_company: lead.insurance_company || "",
    claim_number: lead.claim_number || "",
    adjuster_name: lead.adjuster_name || "",
    inspection_date: lead.inspection_date ? lead.inspection_date.slice(0, 16) : "",
    follow_up_date: lead.follow_up_date ? lead.follow_up_date.slice(0, 16) : "",
  });
  const [saving, setSaving] = useState(false);

  const save = async function(field, value) {
    try {
      await db.update("leads", lead.id, { [field]: value || null });
      onUpdate(Object.assign({}, lead, { [field]: value }));
      if (field === "stage") {
        await logActivity(db, lead.id, "lead", "Stage Change", "Moved to " + value, profile ? profile.full_name || "Admin" : "Admin");
      }
    } catch (e) { Sentry.captureException(e); }
  };

  const saveAll = async function() {
    setSaving(true);
    try {
      const data = {
        name: form.name,
        phone: form.phone,
        email: form.email,
        address: form.address,
        source: form.source,
        notes: form.notes,
        proposal_amount: parseFloat(form.proposal_amount) || null,
        insurance_company: form.insurance_company || null,
        claim_number: form.claim_number || null,
        adjuster_name: form.adjuster_name || null,
        inspection_date: form.inspection_date || null,
        follow_up_date: form.follow_up_date || null,
      };
      await db.update("leads", lead.id, data);
      onUpdate(Object.assign({}, lead, data));
      alert("Saved!");
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const tabs = [
    { id: "details", label: "Details" },
    { id: "insurance", label: "Insurance" },
    { id: "activity", label: "Activity" },
    { id: "photos", label: "Photos" },
    { id: "docs", label: "Docs" },
  ];

  return (
    <Modal title={lead.name} onClose={onClose} wide noPad>
      <div className="flex-shrink-0 px-5 pt-4 pb-0">
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pipeline Stage</label>
          <select
            value={form.stage}
            onChange={async function(e) { setForm(Object.assign({}, form, { stage: e.target.value })); await save("stage", e.target.value); }}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
          >
            {LEAD_STAGES.map(function(s) { return <option key={s} value={s}>{STAGE_ICONS[s] || ""} {s}</option>; })}
          </select>
        </div>
        {form.stage === "Sold" && (
          <button onClick={function() { onConvert(lead); }}
            className="w-full mb-4 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
            🚀 Convert to Job
          </button>
        )}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto mb-4">
          {tabs.map(function(t) {
            return (
              <button key={t.id} onClick={function() { setTab(t.id); }}
                className={"flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors " + (tab === t.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "details" && (
        <div className="px-5 pb-5 space-y-0">
          <Field label="Full Name" value={form.name} onChange={function(v) { setForm(Object.assign({}, form, { name: v })); }} required />
          <Field label="Phone" value={form.phone} onChange={function(v) { setForm(Object.assign({}, form, { phone: v })); }} type="tel" />
          <Field label="Email" value={form.email} onChange={function(v) { setForm(Object.assign({}, form, { email: v })); }} type="email" />
          <Field label="Address" value={form.address} onChange={function(v) { setForm(Object.assign({}, form, { address: v })); }} />
          {form.address && (
            <a href={mapsUrl(form.address)} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full border border-blue-200 bg-blue-50 text-blue-700 font-semibold py-2.5 rounded-xl text-sm mb-4 hover:bg-blue-100 transition-colors">
              🗺️ Get Directions
            </a>
          )}
          <Field label="Source" value={form.source} onChange={function(v) { setForm(Object.assign({}, form, { source: v })); }} options={LEAD_SOURCES} />
          <Field label="Proposal Amount ($)" value={form.proposal_amount} onChange={function(v) { setForm(Object.assign({}, form, { proposal_amount: v })); }} type="number" />
          <Field label="Inspection Date" value={form.inspection_date} onChange={function(v) { setForm(Object.assign({}, form, { inspection_date: v })); }} type="datetime-local" />
          <Field label="Follow-Up Date" value={form.follow_up_date} onChange={function(v) { setForm(Object.assign({}, form, { follow_up_date: v })); }} type="datetime-local" />
          <Field label="Notes" value={form.notes} onChange={function(v) { setForm(Object.assign({}, form, { notes: v })); }} type="textarea" />
          <button onClick={saveAll} disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save Changes"}</button>
        </div>
      )}

      {tab === "insurance" && (
        <div className="px-5 pb-5 space-y-0">
          <div className="bg-blue-50 rounded-xl p-4 mb-5">
            <p className="text-sm font-semibold text-blue-900">Insurance Claim Tracking</p>
            <p className="text-xs text-blue-600 mt-0.5">Track adjuster info, claim numbers, and mortgage details</p>
          </div>
          <Field label="Insurance Company" value={form.insurance_company} onChange={function(v) { setForm(Object.assign({}, form, { insurance_company: v })); }} />
          <Field label="Claim Number" value={form.claim_number} onChange={function(v) { setForm(Object.assign({}, form, { claim_number: v })); }} />
          <Field label="Adjuster Name" value={form.adjuster_name} onChange={function(v) { setForm(Object.assign({}, form, { adjuster_name: v })); }} />
          <button onClick={saveAll} disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save Insurance Info"}</button>
        </div>
      )}

      {tab === "activity" && <ActivityFeed relatedId={lead.id} userName={profile ? profile.full_name || profile.email : "Team"} />}
      {tab === "photos" && <FilePanel relatedId={lead.id} relatedType="lead-photos" token={token} db={db} />}
      {tab === "docs" && <FilePanel relatedId={lead.id} relatedType="lead-docs" token={token} db={db} />}
    </Modal>
  );
}

// ─── JOB DETAIL ───────────────────────────────────────────────────────────────
function JobDetail({ job, db, token, profile, onClose, onUpdate }) {
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState({
    stage: job.stage || "Scheduled",
    title: job.title || "",
    customer: job.customer || "",
    phone: job.phone || "",
    email: job.email || "",
    address: job.address || "",
    type: job.type || "Other",
    value: job.value || "",
    crew: job.crew || "",
    materials: job.materials || "",
    permit: job.permit || "",
    start_date: job.start_date || "",
    notes: job.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const save = async function(field, value) {
    try {
      await db.update("jobs", job.id, { [field]: value || null });
      onUpdate(Object.assign({}, job, { [field]: value }));
      if (field === "stage") {
        await logActivity(db, job.id, "job", "Stage Change", "Moved to " + value, profile ? profile.full_name || "Admin" : "Admin");
      }
    } catch (e) { Sentry.captureException(e); }
  };

  const saveAll = async function() {
    setSaving(true);
    try {
      const data = {
        title: form.title,
        customer: form.customer,
        phone: form.phone,
        email: form.email,
        address: form.address,
        type: form.type,
        value: parseFloat(form.value) || 0,
        crew: form.crew || null,
        materials: form.materials || null,
        permit: form.permit || null,
        start_date: form.start_date || null,
        notes: form.notes || null,
      };
      await db.update("jobs", job.id, data);
      onUpdate(Object.assign({}, job, data));
      alert("Saved!");
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const tabs = [
    { id: "details", label: "Details" },
    { id: "tasks", label: "Tasks" },
    { id: "activity", label: "Activity" },
    { id: "photos", label: "Photos" },
    { id: "docs", label: "Docs" },
  ];

  return (
    <Modal title={job.title} onClose={onClose} wide noPad>
      <div className="flex-shrink-0 px-5 pt-4 pb-0">
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Job Stage</label>
          <select
            value={form.stage}
            onChange={async function(e) { setForm(Object.assign({}, form, { stage: e.target.value })); await save("stage", e.target.value); }}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
          >
            {JOB_STAGES.map(function(s) { return <option key={s} value={s}>{STAGE_ICONS[s] || ""} {s}</option>; })}
          </select>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Contract Value</p>
            <p className="text-2xl font-bold text-white">${Number(form.value || 0).toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Customer</p>
            <p className="text-sm font-semibold text-white">{form.customer || "—"}</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto mb-4">
          {tabs.map(function(t) {
            return (
              <button key={t.id} onClick={function() { setTab(t.id); }}
                className={"flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors " + (tab === t.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "details" && (
        <div className="px-5 pb-5">
          <Field label="Job Title" value={form.title} onChange={function(v) { setForm(Object.assign({}, form, { title: v })); }} required />
          <Field label="Customer Name" value={form.customer} onChange={function(v) { setForm(Object.assign({}, form, { customer: v })); }} />
          <Field label="Phone" value={form.phone} onChange={function(v) { setForm(Object.assign({}, form, { phone: v })); }} type="tel" />
          <Field label="Email" value={form.email} onChange={function(v) { setForm(Object.assign({}, form, { email: v })); }} type="email" />
          <Field label="Address" value={form.address} onChange={function(v) { setForm(Object.assign({}, form, { address: v })); }} />
          {form.address && (
            <a href={mapsUrl(form.address)} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full border border-blue-200 bg-blue-50 text-blue-700 font-semibold py-2.5 rounded-xl text-sm mb-4 hover:bg-blue-100 transition-colors">
              🗺️ Get Directions
            </a>
          )}
          <Field label="Job Type" value={form.type} onChange={function(v) { setForm(Object.assign({}, form, { type: v })); }} options={JOB_TYPES} />
          <Field label="Contract Value ($)" value={form.value} onChange={function(v) { setForm(Object.assign({}, form, { value: v })); }} type="number" />
          <Field label="Start Date" value={form.start_date} onChange={function(v) { setForm(Object.assign({}, form, { start_date: v })); }} type="date" />
          <Field label="Crew" value={form.crew} onChange={function(v) { setForm(Object.assign({}, form, { crew: v })); }} placeholder="Who is working this job?" />
          <Field label="Materials" value={form.materials} onChange={function(v) { setForm(Object.assign({}, form, { materials: v })); }} placeholder="Materials needed..." />
          <Field label="Permit #" value={form.permit} onChange={function(v) { setForm(Object.assign({}, form, { permit: v })); }} />
          <Field label="Notes" value={form.notes} onChange={function(v) { setForm(Object.assign({}, form, { notes: v })); }} type="textarea" />
          <button onClick={saveAll} disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save Changes"}</button>
        </div>
      )}

      {tab === "tasks" && <ProductionTasks jobId={job.id} db={db} />}
      {tab === "activity" && <ActivityFeed relatedId={job.id} userName={profile ? profile.full_name || profile.email : "Team"} />}
      {tab === "photos" && <FilePanel relatedId={job.id} relatedType="job-photos" token={token} db={db} />}
      {tab === "docs" && <FilePanel relatedId={job.id} relatedType="job-docs" token={token} db={db} />}
    </Modal>
  );
}

// ─── KANBAN BOARD ─────────────────────────────────────────────────────────────
function KanbanBoard({ leads, onSelect, onStageChange }) {
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  return (
    <div className="overflow-x-auto -mx-4 px-4 pb-4">
      <div className="flex gap-3" style={{ minWidth: LEAD_STAGES.length * 220 + "px" }}>
        {LEAD_STAGES.map(function(stage) {
          const col = leads.filter(function(l) { return (l.stage || "New Lead") === stage; });
          const isOver = dragOver === stage;
          const totalValue = col.reduce(function(s, l) { return s + Number(l.proposal_amount || 0); }, 0);
          return (
            <div key={stage} className="flex-shrink-0 w-52"
              onDragOver={function(e) { e.preventDefault(); setDragOver(stage); }}
              onDrop={async function(e) { e.preventDefault(); if (dragId) { await onStageChange(dragId, stage); } setDragId(null); setDragOver(null); }}
              onDragLeave={function() { setDragOver(null); }}>
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{STAGE_ICONS[stage] || ""}</span>
                  <span className="text-xs font-bold text-gray-700">{stage}</span>
                  <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{col.length}</span>
                </div>
                {totalValue > 0 && <span className="text-[10px] text-gray-400 font-medium">${(totalValue / 1000).toFixed(0)}k</span>}
              </div>
              <div className={"min-h-20 rounded-2xl p-1.5 space-y-2 transition-all " + (isOver ? "bg-gray-200 border-2 border-dashed border-gray-400" : "bg-gray-50")}>
                {col.map(function(lead) {
                  return (
                    <div key={lead.id}
                      draggable
                      onDragStart={function(e) { setDragId(lead.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={function() { setDragId(null); setDragOver(null); }}
                      onClick={function() { onSelect(lead); }}
                      className={"bg-white rounded-xl border border-gray-100 shadow-sm p-3 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all " + (dragId === lead.id ? "opacity-40 scale-95" : "")}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                          {lead.name ? lead.name[0].toUpperCase() : "?"}
                        </div>
                        <span className="font-semibold text-xs text-gray-900 truncate">{lead.name}</span>
                      </div>
                      {lead.proposal_amount > 0 && (
                        <p className="text-xs font-bold text-gray-800">${Number(lead.proposal_amount).toLocaleString()}</p>
                      )}
                      {lead.address && <AddressLink address={lead.address} className="text-[10px] mt-1 block truncate" />}
                      {lead.inspection_date && (
                        <p className="text-[10px] text-purple-500 mt-1">🔍 {new Date(lead.inspection_date).toLocaleDateString()}</p>
                      )}
                      {lead.follow_up_date && (
                        <p className={"text-[10px] mt-0.5 " + (new Date(lead.follow_up_date) < new Date() ? "text-red-500 font-semibold" : "text-orange-400")}>
                          🔔 {new Date(lead.follow_up_date).toLocaleDateString()}
                        </p>
                      )}
                      {lead.claim_number && <p className="text-[10px] text-blue-500 mt-1">📋 {lead.claim_number}</p>}
                    </div>
                  );
                })}
                {col.length === 0 && (
                  <div className="text-center py-6 text-gray-300 text-xs">{isOver ? "Drop here" : "Empty"}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── LEADS VIEW ───────────────────────────────────────────────────────────────
function LeadsView({ db, token, profile }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("board");
  const [stageFilter, setStageFilter] = useState("All");
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", source: "Referral", stage: "New Lead", notes: "" });
  const [saving, setSaving] = useState(false);
  const isOwner = profile && profile.email === "ianmromero14@gmail.com";


  const load = useCallback(async function() {
    setLoading(true);
    try { setLeads(await db.list("leads")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(function() { load(); }, [load]);

  const filtered = leads.filter(function(l) {
    const matchSearch = !search || (l.name && l.name.toLowerCase().includes(search.toLowerCase())) || (l.phone && l.phone.includes(search)) || (l.address && l.address.toLowerCase().includes(search.toLowerCase()));
    const matchStage = stageFilter === "All" || (l.stage || "New Lead") === stageFilter;
    return matchSearch && matchStage;
  });

  const handleStageChange = async function(leadId, newStage) {
    setLeads(leads.map(function(l) { return l.id === leadId ? Object.assign({}, l, { stage: newStage }) : l; }));
    try {
      await db.update("leads", leadId, { stage: newStage });
      await logActivity(db, leadId, "lead", "Stage Change", "Moved to " + newStage, profile ? profile.full_name || "Admin" : "Admin");
    } catch (e) { Sentry.captureException(e); load(); }
  };

  const addLead = async function() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const created = await db.insert("leads", form);
      await logActivity(db, created[0].id, "lead", "Created", "Lead created for " + form.name, profile ? profile.full_name || "Admin" : "Admin");
      setLeads([created[0]].concat(leads));
      setForm({ name: "", phone: "", email: "", address: "", source: "Referral", stage: "New Lead", notes: "" });
      setShowAdd(false);
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const handleConvert = async function(lead) {
    try {
      const created = await db.insert("jobs", {
        title: lead.name + " - " + (lead.source || "Job"),
        customer: lead.name,
        phone: lead.phone || null,
        email: lead.email || null,
        address: lead.address || null,
        stage: "Scheduled",
        type: "Other",
        value: lead.proposal_amount || 0,
        notes: lead.notes || null,
      });
      const newJob = created[0];
      for (var i = 0; i < DEFAULT_TASKS.length; i++) {
        await db.insert("pipeline_tasks", { job_id: newJob.id, title: DEFAULT_TASKS[i], status: "Pending" });
      }
      await db.update("leads", lead.id, { stage: "Sold" });
      await logActivity(db, lead.id, "lead", "Converted", "Converted to job: " + newJob.title, profile ? profile.full_name || "Admin" : "Admin");
      setLeads(leads.map(function(l) { return l.id === lead.id ? Object.assign({}, l, { stage: "Sold" }) : l; }));
      setSelected(null);
      alert("Converted to job with " + DEFAULT_TASKS.length + " tasks!");
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
  };

  const deleteLead = async function(id) {
    if (!isOwner) { alert("Only Ian can delete leads."); return; }
    if (!confirm("Delete this lead? This cannot be undone.")) return;
    setLeads(leads.filter(function(l) { return l.id !== id; }));
    try { await db.delete("leads", id); } catch (e) { Sentry.captureException(e); load(); }
  };

  const overdueFollowUps = leads.filter(function(l) {
    return l.follow_up_date && new Date(l.follow_up_date) < new Date() && l.stage !== "Lost" && l.stage !== "Sold";
  });

  const pipelineValue = leads.filter(function(l) { return l.stage !== "Lost"; }).reduce(function(s, l) { return s + Number(l.proposal_amount || 0); }, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Pipeline</h2>
          <p className="text-sm text-gray-500">{leads.length} leads · ${pipelineValue.toLocaleString()} pipeline</p>
        </div>
        <button onClick={function() { setShowAdd(true); }} className={btnSm}>+ Add Lead</button>
      </div>

      {overdueFollowUps.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-3 mb-4">
          <p className="text-sm font-bold text-red-800 mb-1">🔔 {overdueFollowUps.length} overdue follow-up{overdueFollowUps.length > 1 ? "s" : ""}</p>
          {overdueFollowUps.slice(0, 3).map(function(l) {
            return (
              <button key={l.id} onClick={function() { setSelected(l); }} className="text-xs text-red-600 hover:underline block">
                {l.name} — was due {new Date(l.follow_up_date).toLocaleDateString()}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          placeholder="Search leads..."
          value={search}
          onChange={function(e) { setSearch(e.target.value); }}
          className="flex-1 min-w-0 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
        />
        <button onClick={function() { setView(view === "board" ? "list" : "board"); }} className={btnOutline}>
          {view === "board" ? "☰ List" : "📋 Board"}
        </button>
      </div>

      {view === "list" && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {["All"].concat(LEAD_STAGES).map(function(s) {
            return (
              <button key={s} onClick={function() { setStageFilter(s); }}
                className={"flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors " + (stageFilter === s ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600")}>
                {s}
              </button>
            );
          })}
        </div>
      )}

      {loading ? <Spinner /> : view === "board" ? (
        <KanbanBoard leads={filtered} onSelect={setSelected} onStageChange={handleStageChange} />
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No leads found</p>}
          {filtered.map(function(lead) {
            return (
              <div key={lead.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-all cursor-pointer" onClick={function() { setSelected(lead); }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white font-bold flex-shrink-0">
                      {lead.name ? lead.name[0].toUpperCase() : "?"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{lead.name}</span>
                        <Badge label={lead.stage || "New Lead"} />
                        {lead.claim_number && <span className="text-xs text-blue-500">📋 Insurance</span>}
                      </div>
                      <p className="text-sm text-gray-500 truncate">{lead.phone}</p>
                      {lead.address && <AddressLink address={lead.address} className="text-xs" />}
                      {lead.proposal_amount > 0 && <p className="text-xs font-bold text-gray-700">💰 ${Number(lead.proposal_amount).toLocaleString()}</p>}
                    </div>
                  </div>
                  {isOwner && <button onClick={function(e) { e.stopPropagation(); deleteLead(lead.id); }} className="text-xs text-red-300 hover:text-red-500 px-2 flex-shrink-0">Del</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <Modal title="Add New Lead" onClose={function() { setShowAdd(false); }}>
          <Field label="Full Name" value={form.name} onChange={function(v) { setForm(Object.assign({}, form, { name: v })); }} required />
          <Field label="Phone" value={form.phone} onChange={function(v) { setForm(Object.assign({}, form, { phone: v })); }} type="tel" />
          <Field label="Email" value={form.email} onChange={function(v) { setForm(Object.assign({}, form, { email: v })); }} type="email" />
          <Field label="Address" value={form.address} onChange={function(v) { setForm(Object.assign({}, form, { address: v })); }} />
          <Field label="Source" value={form.source} onChange={function(v) { setForm(Object.assign({}, form, { source: v })); }} options={LEAD_SOURCES} />
          <Field label="Stage" value={form.stage} onChange={function(v) { setForm(Object.assign({}, form, { stage: v })); }} options={LEAD_STAGES} />
          <Field label="Notes" value={form.notes} onChange={function(v) { setForm(Object.assign({}, form, { notes: v })); }} type="textarea" />
          <button onClick={addLead} disabled={saving || !form.name.trim()} className={btnPrimary}>{saving ? "Adding..." : "Add Lead"}</button>
        </Modal>
      )}

      {selected && (
        <LeadDetail
          lead={selected}
          db={db}
          token={token}
          profile={profile}
          onClose={function() { setSelected(null); }}
          onUpdate={function(updated) {
            setLeads(leads.map(function(l) { return l.id === updated.id ? updated : l; }));
            setSelected(updated);
          }}
          onConvert={handleConvert}
        />
      )}
    </div>
  );
}

// ─── JOBS VIEW ────────────────────────────────────────────────────────────────
function JobsView({ db, token, profile }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ title: "", customer: "", phone: "", email: "", address: "", stage: "Scheduled", type: "Roofing", value: "", start_date: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async function() {
    setLoading(true);
    try { setJobs(await db.list("jobs")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(function() { load(); }, [load]);

  const filtered = jobs.filter(function(j) {
    const matchStage = filter === "All" || (j.stage || "Scheduled") === filter;
    const matchSearch = !search || (j.title && j.title.toLowerCase().includes(search.toLowerCase())) || (j.customer && j.customer.toLowerCase().includes(search.toLowerCase()));
    return matchStage && matchSearch;
  });

  const addJob = async function() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const created = await db.insert("jobs", Object.assign({}, form, { value: parseFloat(form.value) || 0, status: "In Progress" }));
      await logActivity(db, created[0].id, "job", "Created", "Job created: " + form.title, profile ? profile.full_name || "Admin" : "Admin");
      setJobs([created[0]].concat(jobs));
      setForm({ title: "", customer: "", phone: "", email: "", address: "", stage: "Scheduled", type: "Roofing", value: "", start_date: "", notes: "" });
      setShowAdd(false);
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const deleteJob = async function(id) {
    if (!confirm("Delete this job?")) return;
    setJobs(jobs.filter(function(j) { return j.id !== id; }));
    try { await db.delete("jobs", id); } catch (e) { Sentry.captureException(e); load(); }
  };

  const typeIcon = { "Roofing": "🏠", "Siding": "🪵", "Gutters": "🌊", "Windows": "🪟", "Remodeling": "🔨", "Handyman": "🔧", "Painting": "🎨", "Flooring": "🏗️", "Plumbing": "🚿", "Electrical": "⚡", "Other": "📋" };
  const totalValue = filtered.reduce(function(s, j) { return s + Number(j.value || 0); }, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Jobs</h2>
          <p className="text-sm text-gray-500">{filtered.length} jobs · ${totalValue.toLocaleString()}</p>
        </div>
        <button onClick={function() { setShowAdd(true); }} className={btnSm}>+ New Job</button>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          placeholder="Search jobs..."
          value={search}
          onChange={function(e) { setSearch(e.target.value); }}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
        />
      </div>

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {["All"].concat(JOB_STAGES).map(function(s) {
          const count = s === "All" ? jobs.length : jobs.filter(function(j) { return (j.stage || "Scheduled") === s; }).length;
          return (
            <button key={s} onClick={function() { setFilter(s); }}
              className={"flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold transition-colors " + (filter === s ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600")}>
              {s} {count > 0 && <span className={"ml-1 " + (filter === s ? "text-gray-300" : "text-gray-400")}>({count})</span>}
            </button>
          );
        })}
      </div>

      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No jobs found</p>}
          {filtered.map(function(job) {
            return (
              <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-all cursor-pointer" onClick={function() { setSelected(job); }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl flex-shrink-0">{typeIcon[job.type] || "🔧"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{job.title}</span>
                      <Badge label={job.stage || "Scheduled"} />
                    </div>
                    <p className="text-sm text-gray-500 truncate">{job.customer}</p>
                    {job.address && <AddressLink address={job.address} className="text-xs" />}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-sm font-bold text-gray-900">${Number(job.value || 0).toLocaleString()}</span>
                      {job.crew && <span className="text-xs text-gray-400">👷 {job.crew}</span>}
                      {job.start_date && <span className="text-xs text-gray-400">📅 {job.start_date}</span>}
                    </div>
                  </div>
                  <button onClick={function(e) { e.stopPropagation(); deleteJob(job.id); }} className="text-xs text-red-300 hover:text-red-500 px-2 flex-shrink-0">Del</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <Modal title="New Job" onClose={function() { setShowAdd(false); }}>
          <Field label="Job Title" value={form.title} onChange={function(v) { setForm(Object.assign({}, form, { title: v })); }} required />
          <Field label="Customer Name" value={form.customer} onChange={function(v) { setForm(Object.assign({}, form, { customer: v })); }} />
          <Field label="Phone" value={form.phone} onChange={function(v) { setForm(Object.assign({}, form, { phone: v })); }} type="tel" />
          <Field label="Address" value={form.address} onChange={function(v) { setForm(Object.assign({}, form, { address: v })); }} />
          <Field label="Job Type" value={form.type} onChange={function(v) { setForm(Object.assign({}, form, { type: v })); }} options={JOB_TYPES} />
          <Field label="Stage" value={form.stage} onChange={function(v) { setForm(Object.assign({}, form, { stage: v })); }} options={JOB_STAGES} />
          <Field label="Contract Value ($)" value={form.value} onChange={function(v) { setForm(Object.assign({}, form, { value: v })); }} type="number" />
          <Field label="Start Date" value={form.start_date} onChange={function(v) { setForm(Object.assign({}, form, { start_date: v })); }} type="date" />
          <Field label="Notes" value={form.notes} onChange={function(v) { setForm(Object.assign({}, form, { notes: v })); }} type="textarea" />
          <button onClick={addJob} disabled={saving || !form.title.trim()} className={btnPrimary}>{saving ? "Adding..." : "Add Job"}</button>
        </Modal>
      )}

      {selected && (
        <JobDetail
          job={selected}
          db={db}
          token={token}
          profile={profile}
          onClose={function() { setSelected(null); }}
          onUpdate={function(updated) {
            setJobs(jobs.map(function(j) { return j.id === updated.id ? updated : j; }));
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

// ─── ESTIMATES VIEW ───────────────────────────────────────────────────────────
function EstimatesView({ db }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docType, setDocType] = useState("Estimates");
  const [form, setForm] = useState({ number: "", customer: "", amount: "", date: "", status: "Draft", type: "Estimate", notes: "" });

  const load = useCallback(async function() {
    setLoading(true);
    try { setItems(await db.list("estimates")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(function() { load(); }, [load]);

  const filtered = docType === "Estimates"
    ? items.filter(function(i) { return i.type !== "Invoice"; })
    : items.filter(function(i) { return i.type === "Invoice"; });

  const approved = items.filter(function(i) { return i.status === "Approved"; }).reduce(function(s, i) { return s + Number(i.amount || 0); }, 0);
  const paid = items.filter(function(i) { return i.status === "Paid"; }).reduce(function(s, i) { return s + Number(i.amount || 0); }, 0);
  const outstanding = items.filter(function(i) { return i.type === "Invoice" && i.status !== "Paid"; }).reduce(function(s, i) { return s + Number(i.amount || 0); }, 0);

  const addItem = async function() {
    if (!form.number.trim()) return;
    setSaving(true);
    try {
      const created = await db.insert("estimates", Object.assign({}, form, { amount: parseFloat(form.amount) || 0 }));
      setItems([created[0]].concat(items));
      setForm({ number: "", customer: "", amount: "", date: "", status: "Draft", type: form.type, notes: "" });
      setShowAdd(false);
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const deleteItem = async function(id) {
    if (!confirm("Delete?")) return;
    setItems(items.filter(function(i) { return i.id !== id; }));
    try { await db.delete("estimates", id); } catch (e) { load(); }
  };

  const updateStatus = async function(id, status) {
    setItems(items.map(function(i) { return i.id === id ? Object.assign({}, i, { status }) : i; }));
    try { await db.update("estimates", id, { status }); } catch (e) { load(); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Estimates & Invoices</h2>
          <p className="text-sm text-gray-500">{items.length} documents</p>
        </div>
        <button onClick={function() { setShowAdd(true); }} className={btnSm}>+ New</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-xs text-gray-400 font-medium uppercase mb-1">Approved</p>
          <p className="text-xl font-bold text-white">${approved.toLocaleString()}</p>
        </div>
        <div className="bg-green-600 rounded-2xl p-4">
          <p className="text-xs text-green-200 font-medium uppercase mb-1">Collected</p>
          <p className="text-xl font-bold text-white">${paid.toLocaleString()}</p>
        </div>
        <div className="bg-orange-500 rounded-2xl p-4">
          <p className="text-xs text-orange-100 font-medium uppercase mb-1">Outstanding</p>
          <p className="text-xl font-bold text-white">${outstanding.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {["Estimates", "Invoices"].map(function(t) {
          return (
            <button key={t} onClick={function() { setDocType(t); }}
              className={"px-5 py-2 rounded-xl text-sm font-semibold transition-colors " + (docType === t ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600")}>
              {t}
            </button>
          );
        })}
      </div>

      {loading ? <Spinner /> : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No {docType.toLowerCase()} yet</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map(function(item) {
                return (
                  <div key={item.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-gray-900 text-sm">{item.number}</span>
                          <Badge label={item.status} />
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">{item.customer}</p>
                        <p className="text-base font-bold text-gray-900 mt-0.5">${Number(item.amount || 0).toLocaleString()}</p>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                        <select value={item.status}
                          onChange={function(e) { updateStatus(item.id, e.target.value); }}
                          onClick={function(e) { e.stopPropagation(); }}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none">
                          {(item.type === "Invoice" ? ["Draft", "Sent", "Paid", "Void"] : ["Draft", "Sent", "Approved", "Declined"]).map(function(s) { return <option key={s}>{s}</option>; })}
                        </select>
                        <button onClick={function() { deleteItem(item.id); }} className="text-xs text-red-300 hover:text-red-500">Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <Modal title={"New " + (form.type === "Invoice" ? "Invoice" : "Estimate")} onClose={function() { setShowAdd(false); }}>
          <Field label="Type" value={form.type} onChange={function(v) { setForm(Object.assign({}, form, { type: v })); }} options={["Estimate", "Invoice"]} />
          <Field label="Number" value={form.number} onChange={function(v) { setForm(Object.assign({}, form, { number: v })); }} placeholder="EST-001" required />
          <Field label="Customer" value={form.customer} onChange={function(v) { setForm(Object.assign({}, form, { customer: v })); }} />
          <Field label="Amount ($)" value={form.amount} onChange={function(v) { setForm(Object.assign({}, form, { amount: v })); }} type="number" />
          <Field label="Date" value={form.date} onChange={function(v) { setForm(Object.assign({}, form, { date: v })); }} type="date" />
          <Field label="Status" value={form.status} onChange={function(v) { setForm(Object.assign({}, form, { status: v })); }} options={form.type === "Invoice" ? ["Draft", "Sent", "Paid"] : ["Draft", "Sent", "Approved", "Declined"]} />
          <Field label="Notes" value={form.notes} onChange={function(v) { setForm(Object.assign({}, form, { notes: v })); }} type="textarea" />
          <button onClick={addItem} disabled={saving || !form.number.trim()} className={btnPrimary}>{saving ? "Saving..." : "Save"}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── TASKS VIEW ───────────────────────────────────────────────────────────────
function TasksView({ db }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("Pending");
  const [form, setForm] = useState({ title: "", due: "", priority: "Medium", assigned: "", related: "", status: "Pending" });

  const load = useCallback(async function() {
    setLoading(true);
    try { setTasks(await db.list("tasks")); }
    catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(function() { load(); }, [load]);

  const pending = tasks.filter(function(t) { return t.status === "Pending"; });
  const done = tasks.filter(function(t) { return t.status === "Done"; });
  const overdue = pending.filter(function(t) { return t.due && new Date(t.due) < new Date(); });
  const displayed = filter === "Pending" ? pending : done;

  const addTask = async function() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const created = await db.insert("tasks", form);
      setTasks([created[0]].concat(tasks));
      setForm({ title: "", due: "", priority: "Medium", assigned: "", related: "", status: "Pending" });
      setShowAdd(false);
    } catch (e) { Sentry.captureException(e); alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const toggleDone = async function(task) {
    const ns = task.status === "Done" ? "Pending" : "Done";
    setTasks(tasks.map(function(t) { return t.id === task.id ? Object.assign({}, t, { status: ns }) : t; }));
    try { await db.update("tasks", task.id, { status: ns }); } catch (e) { load(); }
  };

  const deleteTask = async function(id) {
    if (!confirm("Delete task?")) return;
    setTasks(tasks.filter(function(t) { return t.id !== id; }));
    try { await db.delete("tasks", id); } catch (e) { load(); }
  };

  const priorityDot = { High: "bg-red-500", Medium: "bg-yellow-400", Low: "bg-gray-300" };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
          <p className="text-sm text-gray-500">{pending.length} pending · {done.length} done{overdue.length > 0 ? " · " + overdue.length + " overdue" : ""}</p>
        </div>
        <button onClick={function() { setShowAdd(true); }} className={btnSm}>+ Add Task</button>
      </div>

      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-3 mb-4">
          <p className="text-sm font-bold text-red-800">⚠️ {overdue.length} overdue task{overdue.length > 1 ? "s" : ""}</p>
          {overdue.slice(0, 2).map(function(t) {
            return <p key={t.id} className="text-xs text-red-600 mt-1">{t.title} — was due {t.due}</p>;
          })}
        </div>
      )}

      <div className="flex gap-2 mb-5">
        {["Pending", "Done"].map(function(s) {
          return (
            <button key={s} onClick={function() { setFilter(s); }}
              className={"px-5 py-2 rounded-xl text-sm font-semibold transition-colors " + (filter === s ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600")}>
              {s} ({s === "Pending" ? pending.length : done.length})
            </button>
          );
        })}
      </div>

      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {displayed.length === 0 && <p className="text-center text-gray-400 py-12">No {filter.toLowerCase()} tasks</p>}
          {displayed.map(function(task) {
            const isOverdue = task.status === "Pending" && task.due && new Date(task.due) < new Date();
            return (
              <div key={task.id} className={"bg-white rounded-2xl border shadow-sm p-4 flex items-start gap-3 " + (task.status === "Done" ? "opacity-60 border-gray-100" : isOverdue ? "border-red-200" : "border-gray-100")}>
                <button onClick={function() { toggleDone(task); }}
                  className={"mt-0.5 w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors " + (task.status === "Done" ? "bg-gray-900 border-gray-900" : "border-gray-300 hover:border-gray-600")}>
                  {task.status === "Done" && <span className="text-white text-xs">✓</span>}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={"font-medium text-sm " + (task.status === "Done" ? "line-through text-gray-400" : "text-gray-900")}>{task.title}</span>
                    <span className={"w-2 h-2 rounded-full flex-shrink-0 " + (priorityDot[task.priority] || "bg-gray-300")}></span>
                    <span className="text-xs text-gray-400">{task.priority}</span>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs flex-wrap">
                    {task.due && <span className={isOverdue ? "text-red-500 font-semibold" : "text-gray-400"}>📅 {task.due}</span>}
                    {task.assigned && <span className="text-gray-400">👤 {task.assigned}</span>}
                    {task.related && <span className="text-gray-400">🔗 {task.related}</span>}
                  </div>
                </div>
                <button onClick={function() { deleteTask(task.id); }} className="text-gray-300 hover:text-red-400 text-sm px-1 flex-shrink-0">X</button>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <Modal title="Add Task" onClose={function() { setShowAdd(false); }}>
          <Field label="Task" value={form.title} onChange={function(v) { setForm(Object.assign({}, form, { title: v })); }} required />
          <Field label="Due Date" value={form.due} onChange={function(v) { setForm(Object.assign({}, form, { due: v })); }} type="date" />
          <Field label="Priority" value={form.priority} onChange={function(v) { setForm(Object.assign({}, form, { priority: v })); }} options={["High", "Medium", "Low"]} />
          <Field label="Assigned To" value={form.assigned} onChange={function(v) { setForm(Object.assign({}, form, { assigned: v })); }} />
          <Field label="Related Job / Lead" value={form.related} onChange={function(v) { setForm(Object.assign({}, form, { related: v })); }} />
          <button onClick={addTask} disabled={saving || !form.title.trim()} className={btnPrimary}>{saving ? "Adding..." : "Add Task"}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function CalendarView({ db }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(new Date());

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        const results = await Promise.all([
          db.list("leads"),
          db.list("jobs"),
          db.list("tasks"),
        ]);
        const leads = results[0]; const jobs = results[1]; const tasks = results[2];
        var all = [];
        leads.forEach(function(l) {
          if (l.inspection_date) all.push({ date: new Date(l.inspection_date), label: "🔍 " + l.name, color: "bg-purple-100 text-purple-800", type: "inspection" });
          if (l.follow_up_date) all.push({ date: new Date(l.follow_up_date), label: "🔔 " + l.name, color: "bg-orange-100 text-orange-800", type: "followup" });
        });
        jobs.forEach(function(j) {
          if (j.start_date) all.push({ date: new Date(j.start_date), label: "🏗️ " + j.title, color: "bg-blue-100 text-blue-800", type: "job" });
        });
        tasks.forEach(function(t) {
          if (t.due && t.status === "Pending") all.push({ date: new Date(t.due), label: "✅ " + t.title, color: "bg-gray-100 text-gray-700", type: "task" });
        });
        setEvents(all);
      } catch (e) { Sentry.captureException(e); }
      finally { setLoading(false); }
    }
    load();
  }, [db]);

  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = current.toLocaleString("default", { month: "long", year: "numeric" });
  const today = new Date();

  const getDay = function(day) {
    return events.filter(function(e) {
      const d = e.date;
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  };

  const upcoming = events
    .filter(function(e) { return e.date >= today && e.date.getMonth() === month && e.date.getFullYear() === year; })
    .sort(function(a, b) { return a.date - b.date; })
    .slice(0, 8);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Calendar</h2>
          <p className="text-sm text-gray-500">Inspections, jobs and follow-ups</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={function() { setCurrent(new Date(year, month - 1, 1)); }} className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg">‹</button>
          <span className="text-sm font-semibold text-gray-700 w-36 text-center">{monthName}</span>
          <button onClick={function() { setCurrent(new Date(year, month + 1, 1)); }} className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg">›</button>
        </div>
      </div>

      <div className="flex gap-4 mb-4 text-xs">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block"></span>Inspection</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block"></span>Follow-up</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block"></span>Job</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block"></span>Task</span>
      </div>

      {loading ? <Spinner /> : (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
            <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(function(d) {
                return <div key={d} className="text-center text-xs font-semibold text-gray-400 py-3">{d}</div>;
              })}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: firstDay }).map(function(_, i) {
                return <div key={"e" + i} className="min-h-16 border-b border-r border-gray-50 bg-gray-50/50" />;
              })}
              {Array.from({ length: daysInMonth }).map(function(_, i) {
                const day = i + 1;
                const dayEvents = getDay(day);
                const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
                return (
                  <div key={day} className={"min-h-16 border-b border-r border-gray-50 p-1 " + (isToday ? "bg-gray-900" : "hover:bg-gray-50")}>
                    <p className={"text-xs font-bold mb-1 " + (isToday ? "text-white" : "text-gray-700")}>{day}</p>
                    {dayEvents.slice(0, 2).map(function(ev, idx) {
                      return <div key={idx} className={"text-[10px] px-1 py-0.5 rounded mb-0.5 truncate " + ev.color}>{ev.label}</div>;
                    })}
                    {dayEvents.length > 2 && <p className="text-[10px] text-gray-400">+{dayEvents.length - 2}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {upcoming.length > 0 && (
            <div>
              <h3 className="font-bold text-gray-900 mb-3">Coming Up</h3>
              <div className="space-y-2">
                {upcoming.map(function(ev, i) {
                  return (
                    <div key={i} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 p-3">
                      <div className="text-center w-10 flex-shrink-0">
                        <p className="text-[10px] text-gray-400 uppercase">{ev.date.toLocaleString("default", { month: "short" })}</p>
                        <p className="text-lg font-bold text-gray-900 leading-none">{ev.date.getDate()}</p>
                      </div>
                      <span className={"text-xs px-2.5 py-1 rounded-full font-medium " + ev.color}>{ev.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ db, setTab }) {
  const [data, setData] = useState({ leads: [], jobs: [], tasks: [] });
  const [loading, setLoading] = useState(true);

  useEffect(function() {
    async function load() {
      try {
        const results = await Promise.all([db.list("leads"), db.list("jobs"), db.list("tasks")]);
        setData({ leads: results[0], jobs: results[1], tasks: results[2] });
      } catch (e) { Sentry.captureException(e); }
      finally { setLoading(false); }
    }
    load();
  }, [db]);

  const pipeline = data.leads.filter(function(l) { return l.stage !== "Lost"; }).reduce(function(s, l) { return s + Number(l.proposal_amount || 0); }, 0);
  const activeJobs = data.jobs.filter(function(j) { return j.stage === "In Progress" || j.stage === "Scheduled"; });
  const pendingTasks = data.tasks.filter(function(t) { return t.status === "Pending"; });
  const overdueTasks = pendingTasks.filter(function(t) { return t.due && new Date(t.due) < new Date(); });
  const overdueFollowUps = data.leads.filter(function(l) { return l.follow_up_date && new Date(l.follow_up_date) < new Date() && l.stage !== "Lost" && l.stage !== "Sold"; });

  const stageBreakdown = LEAD_STAGES.map(function(s) {
    return { stage: s, count: data.leads.filter(function(l) { return (l.stage || "New Lead") === s; }).length };
  });

  const revenueThisMonth = data.jobs.filter(function(j) {
    if (!j.stage || j.stage !== "Complete") return false;
    return true;
  }).reduce(function(s, j) { return s + Number(j.value || 0); }, 0);

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-sm text-gray-500">EJI Handyman Services</p>
      </div>

      {loading ? <Spinner /> : (
        <>
          {(overdueFollowUps.length > 0 || overdueTasks.length > 0) && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-5">
              <p className="text-sm font-bold text-red-800 mb-1">⚠️ Needs Attention</p>
              {overdueFollowUps.length > 0 && <p className="text-xs text-red-600">{overdueFollowUps.length} overdue follow-up{overdueFollowUps.length > 1 ? "s" : ""}</p>}
              {overdueTasks.length > 0 && <p className="text-xs text-red-600">{overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-5">
            <button onClick={function() { setTab("leads"); }} className="bg-gray-900 rounded-2xl p-4 text-left hover:bg-gray-800 transition-colors">
              <p className="text-3xl font-bold text-white">{data.leads.length}</p>
              <p className="text-xs text-gray-400 mt-1 font-medium uppercase">Total Leads</p>
              <p className="text-sm font-semibold text-gray-300 mt-0.5">${pipeline.toLocaleString()} pipeline</p>
            </button>
            <button onClick={function() { setTab("jobs"); }} className="bg-gray-700 rounded-2xl p-4 text-left hover:bg-gray-600 transition-colors">
              <p className="text-3xl font-bold text-white">{activeJobs.length}</p>
              <p className="text-xs text-gray-400 mt-1 font-medium uppercase">Active Jobs</p>
              <p className="text-sm font-semibold text-gray-300 mt-0.5">{data.jobs.length} total</p>
            </button>
            <button onClick={function() { setTab("tasks"); }} className="bg-gray-600 rounded-2xl p-4 text-left hover:bg-gray-500 transition-colors">
              <p className="text-3xl font-bold text-white">{pendingTasks.length}</p>
              <p className="text-xs text-gray-400 mt-1 font-medium uppercase">Tasks Due</p>
              {overdueTasks.length > 0 && <p className="text-xs text-red-300 mt-0.5">{overdueTasks.length} overdue</p>}
            </button>
            <button onClick={function() { setTab("estimates"); }} className="bg-gray-500 rounded-2xl p-4 text-left hover:bg-gray-400 transition-colors">
              <p className="text-3xl font-bold text-white">${revenueThisMonth.toLocaleString()}</p>
              <p className="text-xs text-gray-300 mt-1 font-medium uppercase">Jobs Complete</p>
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <h3 className="font-bold text-gray-900 mb-4">Lead Pipeline</h3>
            <div className="space-y-2.5">
              {stageBreakdown.filter(function(s) { return s.count > 0; }).map(function(s) {
                return (
                  <div key={s.stage} className="flex items-center gap-3">
                    <span className="text-sm w-5">{STAGE_ICONS[s.stage]}</span>
                    <span className="text-sm text-gray-600 w-28 flex-shrink-0">{s.stage}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className="bg-gray-900 h-2 rounded-full transition-all" style={{ width: (data.leads.length ? (s.count / data.leads.length) * 100 : 0) + "%" }} />
                    </div>
                    <span className="text-sm font-bold text-gray-800 w-5 text-right">{s.count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <h3 className="font-bold text-gray-900 mb-3">Recent Jobs</h3>
            {activeJobs.length === 0 ? (
              <p className="text-sm text-gray-400">No active jobs</p>
            ) : (
              <div className="space-y-3">
                {activeJobs.slice(0, 4).map(function(job) {
                  return (
                    <div key={job.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{job.title}</p>
                        <p className="text-xs text-gray-400">{job.customer}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-bold text-gray-700">${Number(job.value || 0).toLocaleString()}</span>
                        <Badge label={job.stage || "Scheduled"} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {pendingTasks.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-900 mb-3">Upcoming Tasks</h3>
              <div className="space-y-2">
                {pendingTasks.slice(0, 4).map(function(task) {
                  const isOverdue = task.due && new Date(task.due) < new Date();
                  return (
                    <div key={task.id} className="flex items-center gap-3">
                      <span className={"w-2 h-2 rounded-full flex-shrink-0 " + (isOverdue ? "bg-red-500" : task.priority === "High" ? "bg-red-400" : task.priority === "Medium" ? "bg-yellow-400" : "bg-gray-300")}></span>
                      <p className="text-sm text-gray-700 flex-1 truncate">{task.title}</p>
                      {task.due && <span className={"text-xs " + (isOverdue ? "text-red-500 font-semibold" : "text-gray-400")}>{task.due}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function AdminPanel({ db, currentUser, onBadgeUpdate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "member" });

  const load = useCallback(async function() {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([
        db.list("profiles", "select=*&order=created_at.desc"),
        fetch(SUPABASE_URL + "/rest/v1/access_requests?select=*&order=created_at.desc", { headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY } }).then(function(r) { return r.json(); }),
      ]);
      setUsers(u);
      setRequests(r);
      if (onBadgeUpdate) onBadgeUpdate(r.filter(function(x) { return x.status === "Pending"; }).length);
    } catch (e) { Sentry.captureException(e); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(function() { load(); }, [load]);

  const updateRole = async function(id, role) {
    setUsers(users.map(function(u) { return u.id === id ? Object.assign({}, u, { role }) : u; }));
    try { await db.update("profiles", id, { role }); } catch (e) { load(); }
  };

  const createUser = async function() {
    if (!form.email || !form.password) return;
    setSaving(true); setMsg("");
    try {
      const r = await fetch(SUPABASE_URL + "/auth/v1/admin/users", {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password, email_confirm: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.msg || "Failed");
      await db.update("profiles", d.id, { role: form.role, full_name: form.full_name });
      setMsg("User created!");
      setForm({ full_name: "", email: "", password: "", role: "member" });
      load();
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const denyRequest = async function(id) {
    await fetch(SUPABASE_URL + "/rest/v1/access_requests?id=eq." + id, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Denied" }),
    });
    load();
  };

  const pendingRequests = requests.filter(function(r) { return r.status === "Pending"; });

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Admin</h2>
          <p className="text-sm text-gray-500">Manage team and access</p>
        </div>
        <button onClick={function() { setShowInvite(true); }} className={btnSm}>+ Add User</button>
      </div>

      {pendingRequests.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-5">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            🔑 Access Requests
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{pendingRequests.length}</span>
          </h3>
          <div className="space-y-3">
            {pendingRequests.map(function(req) {
              return (
                <div key={req.id} className="border border-gray-100 rounded-xl p-3">
                  <p className="font-semibold text-gray-900 text-sm">{req.full_name}</p>
                  <p className="text-xs text-gray-500">{req.email}</p>
                  <p className="text-xs text-gray-500 mt-1 italic">"{req.reason}"</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={async function() {
                        const pass = Math.random().toString(36).slice(-8) + "X1!";
                        try {
                          const r = await fetch(SUPABASE_URL + "/auth/v1/admin/users", {
                            method: "POST",
                            headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
                            body: JSON.stringify({ email: req.email, password: pass, email_confirm: true }),
                          });
                          if (!r.ok) throw new Error("Failed to create user");
                          await fetch(SUPABASE_URL + "/rest/v1/access_requests?id=eq." + req.id, {
                            method: "PATCH",
                            headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
                            body: JSON.stringify({ status: "Approved", auto_password: pass }),
                          });
                          await sendEmail("Account Created for " + req.full_name, "<p>URL: build-com-topaz.vercel.app</p><p>Email: " + req.email + "</p><p>Password: <b>" + pass + "</b></p>");
                          alert("Account created! Password: " + pass + " - Text this to " + req.full_name);
                          load();
                        } catch (e) { alert("Error: " + e.message); }
                      }}
                      className="text-xs bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-800">
                      Approve
                    </button>
                    <button onClick={function() { denyRequest(req.id); }} className="text-xs border border-gray-200 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-50">Deny</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-5">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-bold text-gray-900">Team Members</h3>
        </div>
        {loading ? <Spinner /> : (
          <div className="divide-y divide-gray-50">
            {users.map(function(user) {
              return (
                <div key={user.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white font-bold flex-shrink-0">
                    {(user.full_name || user.email || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{user.full_name || "—"}</p>
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {currentUser && user.id === currentUser.id ? (
                      <><Badge label={user.role} /><span className="text-xs text-gray-400">(you)</span></>
                    ) : (
                      <select value={user.role || "member"} onChange={function(e) { updateRole(user.id, e.target.value); }}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none">
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showInvite && (
        <Modal title="Add Team Member" onClose={function() { setShowInvite(false); setMsg(""); }}>
          {msg && <div className={"rounded-xl px-4 py-3 mb-4 text-sm " + (msg.includes("created") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600")}>{msg}</div>}
          <Field label="Full Name" value={form.full_name} onChange={function(v) { setForm(Object.assign({}, form, { full_name: v })); }} />
          <Field label="Email" value={form.email} onChange={function(v) { setForm(Object.assign({}, form, { email: v })); }} type="email" required />
          <Field label="Password" value={form.password} onChange={function(v) { setForm(Object.assign({}, form, { password: v })); }} type="password" required />
          <Field label="Role" value={form.role} onChange={function(v) { setForm(Object.assign({}, form, { role: v })); }} options={["member", "admin"]} />
          <button onClick={createUser} disabled={saving} className={btnPrimary}>{saving ? "Creating..." : "Create Account"}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
function ChangePassword({ token, onClose }) {
  const [form, setForm] = useState({ current: "", newPass: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async function() {
    if (!form.current || !form.newPass || !form.confirm) { setMsg("Please fill in all fields"); return; }
    if (form.newPass !== form.confirm) { setMsg("Passwords do not match"); return; }
    if (form.newPass.length < 6) { setMsg("Password must be at least 6 characters"); return; }
    setSaving(true); setMsg("");
    try {
      const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
        method: "PUT",
        headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ password: form.newPass }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.msg || d.message || "Failed");
      setMsg("Password updated!");
      setTimeout(onClose, 1500);
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Change Password" onClose={onClose}>
      {msg && <div className={"rounded-xl px-4 py-3 mb-4 text-sm " + (msg.includes("updated") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600")}>{msg}</div>}
      <Field label="Current Password" value={form.current} onChange={function(v) { setForm(Object.assign({}, form, { current: v })); }} type="password" />
      <Field label="New Password" value={form.newPass} onChange={function(v) { setForm(Object.assign({}, form, { newPass: v })); }} type="password" />
      <Field label="Confirm New Password" value={form.confirm} onChange={function(v) { setForm(Object.assign({}, form, { confirm: v })); }} type="password" />
      <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Updating..." : "Update Password"}</button>
    </Modal>
  );
}

// ─── REQUEST ACCESS ───────────────────────────────────────────────────────────
function RequestAccess({ onBack }) {
  const [form, setForm] = useState({ full_name: "", email: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async function() {
    if (!form.full_name || !form.email || !form.reason) { setError("Please fill in all fields"); return; }
    setSaving(true); setError("");
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1/access_requests", {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error("Failed to submit");
      await sendEmail("New Access Request from " + form.full_name, "<p><b>Name:</b> " + form.full_name + "</p><p><b>Email:</b> " + form.email + "</p><p><b>Reason:</b> " + form.reason + "</p><p><a href='https://build-com-topaz.vercel.app'>Open App</a></p>");
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (done) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✅</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Request Submitted</h2>
        <p className="text-gray-500 text-sm mb-6">Ian will review and contact you at <strong>{form.email}</strong>.</p>
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 underline">Back to Sign In</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6"><LogoLogin /></div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Request Access</h1>
        <p className="text-gray-500 text-sm mb-6">Fill out the form and we will get back to you.</p>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}
          <Field label="Full Name" value={form.full_name} onChange={function(v) { setForm(Object.assign({}, form, { full_name: v })); }} required />
          <Field label="Email" value={form.email} onChange={function(v) { setForm(Object.assign({}, form, { email: v })); }} type="email" required />
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Why do you need access? <span className="text-red-500">*</span></label>
            <textarea value={form.reason} onChange={function(e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} rows={3} placeholder="I work for EJI Handyman..."
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none" />
          </div>
          <button onClick={submit} disabled={saving} className={btnPrimary + " mb-3"}>{saving ? "Submitting..." : "Submit Request"}</button>
          <button onClick={onBack} className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 text-center">Back to Sign In</button>
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRequest, setShowRequest] = useState(false);

  if (showRequest) return <RequestAccess onBack={function() { setShowRequest(false); }} />;

  const handleLogin = async function() {
    if (!email || !password) { setError("Please enter your email and password"); return; }
    setLoading(true); setError("");
    try {
      const session = await signIn(email, password);
      const profile = await getProfile(session.user.id, session.access_token);
      onLogin({ session, profile });
    } catch (e) { Sentry.captureException(e); setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div className="hidden lg:flex flex-col justify-between w-2/5 bg-gray-900 p-12">
        <LogoLogin />
        <div>
          <h2 className="text-3xl font-bold text-white mb-3">Run your business from your phone.</h2>
          <p className="text-gray-400">Leads, jobs, estimates, and tasks — all in one place for EJI Handyman Services.</p>
        </div>
        <p className="text-gray-600 text-sm">Simplicity CRM</p>
      </div>
      <div className="flex-1 flex items-center justify-center px-6 bg-gray-50">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-8 lg:hidden"><LogoLogin /></div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h1>
          <p className="text-gray-500 text-sm mb-8">Sign in to Simplicity CRM</p>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input type="email" value={email} onChange={function(e) { setEmail(e.target.value); }}
                placeholder="you@example.com" autoComplete="email"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                onKeyDown={function(e) { if (e.key === "Enter") handleLogin(); }} />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <input type="password" value={password} onChange={function(e) { setPassword(e.target.value); }}
                placeholder="Your password" autoComplete="current-password"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                onKeyDown={function(e) { if (e.key === "Enter") handleLogin(); }} />
            </div>
            <button onClick={handleLogin} disabled={loading} className={btnPrimary}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </div>
          <p className="text-center text-sm text-gray-400 mt-5">
            Need access?{" "}
            <button onClick={function() { setShowRequest(true); }} className="text-gray-700 font-semibold hover:underline">Request it here</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [adminBadge, setAdminBadge] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(function() {
    const saved = localStorage.getItem("simplicity_auth");
    if (saved) {
      try { setAuth(JSON.parse(saved)); }
      catch (e) { localStorage.removeItem("simplicity_auth"); }
    }
  }, []);

  const handleLogin = function(authData) {
    setAuth(authData);
    localStorage.setItem("simplicity_auth", JSON.stringify(authData));
  };

  const handleLogout = async function() {
    if (auth && auth.session && auth.session.access_token) {
      try { await signOut(auth.session.access_token); } catch (e) { }
    }
    setAuth(null);
    localStorage.removeItem("simplicity_auth");
  };

  if (!auth) return <Login onLogin={handleLogin} />;

  const db = makeDb(auth.session.access_token);
  const profile = auth.profile;
  const isAdmin = profile && profile.role === "admin";
  const initials = profile ? ((profile.full_name || profile.email || "?")[0]).toUpperCase() : "?";

  const navItems = [
    { id: "dashboard", icon: "📊", label: "Home" },
    { id: "leads", icon: "👥", label: "Pipeline" },
    { id: "jobs", icon: "🏗️", label: "Jobs" },
    { id: "estimates", icon: "📋", label: "Estimates" },
    { id: "tasks", icon: "✅", label: "Tasks" },
    { id: "calendar", icon: "📅", label: "Calendar" },
  ].concat(isAdmin ? [{ id: "admin", icon: "⚙️", label: "Admin", badge: adminBadge }] : []);

  return (
    <Sentry.ErrorBoundary fallback={
      <div className="p-8 text-center min-h-screen flex flex-col items-center justify-center">
        <p className="text-red-600 font-semibold text-lg mb-2">Something went wrong</p>
        <p className="text-gray-400 text-sm mb-6">The app encountered an error. Please reload.</p>
        <button onClick={function() { window.location.reload(); }} className="px-6 py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold">Reload App</button>
      </div>
    }>
      <div className="min-h-screen bg-gray-50" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>

        {/* Top bar */}
        <div className="fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-100 shadow-sm">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <Logo size={34} />
            <div className="relative">
              <button
                onClick={function() { setShowUserMenu(!showUserMenu); }}
                className="w-9 h-9 rounded-full bg-gray-900 flex items-center justify-center text-white font-bold text-sm hover:bg-gray-700 transition-colors">
                {initials}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-11 bg-white rounded-2xl shadow-2xl border border-gray-100 w-60 z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-50">
                    <p className="text-sm font-semibold text-gray-900 truncate">{profile ? (profile.full_name || "Team Member") : "User"}</p>
                    <p className="text-xs text-gray-400 truncate">{profile ? profile.email : ""}</p>
                    {profile && <Badge label={profile.role || "member"} />}
                  </div>
                  <button
                    onClick={function() { setShowChangePassword(true); setShowUserMenu(false); }}
                    className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3">
                    🔒 Change Password
                  </button>
                  <button
                    onClick={function() { handleLogout(); setShowUserMenu(false); }}
                    className="w-full text-left px-4 py-3 text-sm text-red-500 hover:bg-red-50 flex items-center gap-3 border-t border-gray-50">
                    🚪 Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-2xl mx-auto px-4 pt-20 pb-28">
          {tab === "dashboard" && <Dashboard db={db} setTab={setTab} />}
          {tab === "leads" && <LeadsView db={db} token={auth.session.access_token} profile={profile} />}
          {tab === "jobs" && <JobsView db={db} token={auth.session.access_token} profile={profile} />}
          {tab === "estimates" && <EstimatesView db={db} />}
          {tab === "tasks" && <TasksView db={db} />}
          {tab === "calendar" && <CalendarView db={db} />}
          {tab === "admin" && isAdmin && <AdminPanel db={db} currentUser={profile} onBadgeUpdate={setAdminBadge} />}
        </div>

        {/* Bottom nav */}
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 shadow-lg safe-area-inset-bottom">
          <div className="max-w-2xl mx-auto px-2 h-16 flex items-center justify-around">
            {navItems.map(function(item) {
              const active = tab === item.id;
              return (
                <button key={item.id} onClick={function() { setTab(item.id); setShowUserMenu(false); }}
                  className={"relative flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl transition-all " + (active ? "text-gray-900" : "text-gray-400 hover:text-gray-600")}>
                  <span className="text-xl leading-none">{item.icon}</span>
                  <span className="text-[10px] font-semibold leading-none">{item.label}</span>
                  {item.badge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{item.badge}</span>
                  )}
                  {active && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-gray-900 rounded-full"></span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Modals */}
        {showChangePassword && <ChangePassword token={auth.session.access_token} onClose={function() { setShowChangePassword(false); }} />}
        {showUserMenu && <div className="fixed inset-0 z-30" onClick={function() { setShowUserMenu(false); }} />}
      </div>
    </Sentry.ErrorBoundary>
  );
}
